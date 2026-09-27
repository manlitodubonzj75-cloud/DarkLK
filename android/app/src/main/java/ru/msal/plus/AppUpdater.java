package ru.msal.plus;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;

/**
 * Самообновление APK из GitHub Releases.
 *
 * JS: window.AndroidUpdater.start(url, sha256) -> getStatus() (поллинг) -> install().
 *
 * Защита:
 *  - качаем только с https://github.com/manlitodubonzj75-cloud/DarkLK/releases/download/…;
 *  - сверяем SHA-256 из манифеста релиза;
 *  - до запуска установщика проверяем: тот же packageName, версия выше, тот же ключ подписи;
 *  - финальную проверку подписи всё равно делает Android: APK с другим ключом
 *    поверх установленного приложения не встанет.
 */
public class AppUpdater {
    private static final String ALLOWED_PREFIX =
        "https://github.com/manlitodubonzj75-cloud/DarkLK/releases/download/";
    private static final long MAX_SIZE = 200L * 1024 * 1024;

    private final Activity activity;
    private volatile String state = "idle"; // idle | downloading | ready | need_permission | installing | error
    private volatile int progress = 0;
    private volatile String error = null;
    private volatile Thread worker = null;

    public AppUpdater(Activity activity) {
        this.activity = activity;
    }

    private File updateFile() {
        File dir = new File(activity.getCacheDir(), "updates");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, "update.apk");
    }

    private void fail(String msg) {
        error = msg;
        state = "error";
        try { updateFile().delete(); } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public String getCurrentVersion() {
        try {
            PackageInfo pi = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            return pi.versionName;
        } catch (Exception e) {
            return null;
        }
    }

    @JavascriptInterface
    public String getStatus() {
        try {
            JSONObject o = new JSONObject();
            o.put("state", state);
            o.put("progress", progress);
            o.put("error", error == null ? JSONObject.NULL : error);
            return o.toString();
        } catch (Exception e) {
            return "{\"state\":\"error\",\"progress\":0,\"error\":\"status\"}";
        }
    }

    @JavascriptInterface
    public boolean start(final String url, final String expectedSha256) {
        if ("downloading".equals(state)) return false;
        if (url == null || !url.startsWith(ALLOWED_PREFIX) || url.contains("..") || url.contains("%2e") || url.contains("%2E") || !url.toLowerCase(Locale.ROOT).endsWith(".apk")) {
            fail("Недопустимый адрес обновления");
            return false;
        }
        if (expectedSha256 == null || !expectedSha256.matches("(?i)[a-f0-9]{64}")) {
            fail("Нет контрольной суммы обновления");
            return false;
        }
        state = "downloading";
        progress = 0;
        error = null;
        worker = new Thread(() -> download(url, expectedSha256.toLowerCase(Locale.ROOT)));
        worker.start();
        return true;
    }

    private void download(String url, String expectedSha256) {
        HttpURLConnection conn = null;
        File out = updateFile();
        try {
            URL current = new URL(url);
            // Редиректы обрабатываем вручную: только https
            for (int i = 0; i < 5; i++) {
                conn = (HttpURLConnection) current.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(20000);
                conn.setReadTimeout(30000);
                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String loc = conn.getHeaderField("Location");
                    conn.disconnect();
                    if (loc == null) throw new Exception("Пустой редирект");
                    URL next = new URL(current, loc);
                    if (!"https".equals(next.getProtocol())) throw new Exception("Небезопасный редирект");
                    current = next;
                    continue;
                }
                if (code != 200) throw new Exception("Сервер вернул " + code);
                break;
            }

            long total = conn.getContentLengthLong();
            if (total > MAX_SIZE) throw new Exception("Слишком большой файл");

            MessageDigest md = MessageDigest.getInstance("SHA-256");
            long done = 0;
            try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(out)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) {
                    done += n;
                    if (done > MAX_SIZE) throw new Exception("Слишком большой файл");
                    md.update(buf, 0, n);
                    fos.write(buf, 0, n);
                    if (total > 0) progress = (int) (done * 100 / total);
                }
            }

            StringBuilder hex = new StringBuilder();
            for (byte b : md.digest()) hex.append(String.format("%02x", b));
            if (!hex.toString().equals(expectedSha256)) throw new Exception("Контрольная сумма не совпала");

            verifyApk(out);
            progress = 100;
            state = "ready";
        } catch (Exception e) {
            fail(e.getMessage() != null ? e.getMessage() : "Ошибка загрузки");
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    @SuppressWarnings("deprecation")
    private void verifyApk(File apk) throws Exception {
        PackageManager pm = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;

        PackageInfo archive = pm.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (archive == null) throw new Exception("Файл обновления повреждён");
        if (!activity.getPackageName().equals(archive.packageName)) throw new Exception("Это APK другого приложения");

        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), flags);
        long newCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? archive.getLongVersionCode() : archive.versionCode;
        long curCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? installed.getLongVersionCode() : installed.versionCode;
        if (newCode <= curCode) throw new Exception("Версия обновления не новее установленной");

        Signature[] a = signaturesOf(archive);
        Signature[] b = signaturesOf(installed);
        // На старых Android подписи архива иногда не читаются — тогда полагаемся на проверку системой при установке
        if (a != null && a.length > 0 && b != null && b.length > 0) {
            if (!sameSignatures(a, b)) throw new Exception("APK подписан чужим ключом");
        }
    }

    @SuppressWarnings("deprecation")
    private Signature[] signaturesOf(PackageInfo pi) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            if (pi.signingInfo == null) return null;
            return pi.signingInfo.hasMultipleSigners()
                ? pi.signingInfo.getApkContentsSigners()
                : pi.signingInfo.getSigningCertificateHistory();
        }
        return pi.signatures;
    }

    private boolean sameSignatures(Signature[] a, Signature[] b) {
        // Совпадения хотя бы одного сертификата из истории достаточно (ротация ключа APK v3)
        for (Signature x : a) {
            for (Signature y : b) {
                if (Arrays.equals(x.toByteArray(), y.toByteArray())) return true;
            }
        }
        return false;
    }

    @JavascriptInterface
    public boolean install() {
        if (!"ready".equals(state) && !"need_permission".equals(state)) return false;
        final File apk = updateFile();
        if (!apk.exists()) {
            fail("Файл обновления не найден");
            return false;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            state = "need_permission";
            activity.runOnUiThread(() -> {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName()));
                activity.startActivity(i);
            });
            return false;
        }

        state = "installing";
        activity.runOnUiThread(() -> {
            try {
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Exception e) {
                fail("Не удалось запустить установщик: " + e.getMessage());
            }
        });
        return true;
    }

    @JavascriptInterface
    public void reset() {
        if ("downloading".equals(state)) return;
        state = "idle";
        progress = 0;
        error = null;
        try { updateFile().delete(); } catch (Exception ignored) {}
    }
}
