# DarkMSAL 1.0 — Клиентское приложение для студентов МГЮА

> *«Для Альма-матер с любовью.»*

**DarkMSAL** — современное, быстрое и полностью автономное кроссплатформенное приложение для студентов и учащихся колледжа **Московского государственного юридического университета имени О.Е. Кутафина (МГЮА)**.

---

## ⚡ Ключевые возможности

- 🔒 **Zero-Proxy & Прямое TLS-соединение**: приложение работает напрямую с официальным сервером `lk.msal.ru:3443`. Никаких промежуточных прокси, сторонних бекендов и сбора телеметрии.
- 🛡️ **Локальное шифрование AES-GCM-256**: токены, учётные данные, сессия почты и кэш хранятся на устройстве зашифрованными. Ключ лежит отдельно — в Android Keystore / iOS Keychain / хранилище ключей ОС (Electron safeStorage) / хранилище менеджера скриптов (Userscript). Нет защищённого хранилища — чувствительные данные на диск не пишутся.
- ⚡ **Мгновенный холодный старт (0 мс)**: расписание на текущий день отображается сразу из локального кэша при входе, после чего фоново синхронизируется с сервером.
- 📅 **Расписание занятий**: удобный просмотр по дням, неделям и месяцам, подсветка текущей пары, быстрый возврат к сегодняшнему дню, аудитории и ФИО преподавателей.
- 🎓 **Электронная зачётная книжка**:
  - Режим **«По семестрам»** (семестры текущего учебного года).
  - Режим **«Вся зачётка»** с полной историей за весь период обучения.
  - Подгрузка дисциплин активной сессии, даты экзаменов/зачётов с обратным отсчётом дней.
- 📝 **Запись на отработки (консультации)**: просмотр доступных консультаций преподавателей кафедр и мгновенная запись/отмена записи в один клик.
- 📊 **БРС и Успеваемость**: модульно-рейтинговые баллы, средний балл, рейтинг студента и журнал пропусков (с поддержкой специфики колледжа).
- 🚀 **Автообновления через GitHub Releases**: встроенная система проверки новых версий из репозитория с уведомлением пользователя и скачиванием актуального пакета под используемую платформу.
- 🎨 **Адаптивный интерфейс**: поддержка системной тёмной и светлой темы, поддержка жеста Pull-to-Refresh на сенсорных экранах и мобильных устройствах.
- 🤖 **Поддержка и открытый исходный код**: официальный Telegram-бот поддержки ([@DarkMSAL_supportbot](https://t.me/DarkMSAL_supportbot)) и исходный код проекта.

---

## 📱 Инструкции по установке на платформы

### 🍏 1. iOS / iPadOS (Safari — через Userscript, рекомендуется)
*Работает без компьютера, без сертификатов разработчика и без риска слёта каждые 7 дней.*

1. Установите бесплатное расширение **[Userscripts в App Store](https://apps.apple.com/app/userscripts/id1463298887)** (или **Stay**).
2. Откройте **Настройки ➔ Safari ➔ Расширения ➔ Userscripts** и включите его. Выдайте разрешение «Всегда разрешать» для `lk.msal.ru`.
3. Откройте в Safari прямую ссылку на скрипт:
   👉 **[Установить DarkMSAL Userscript](https://github.com/manlitodubonzj75-cloud/DarkLK/releases/latest/download/darkmsal.user.js)**  
   *(Скрипт обновляется только из опубликованных релизов, а не из каждого коммита.)*
4. В появившемся окне расширения нажмите **Install** (Установить).
5. Перейдите на [https://lk.msal.ru/](https://lk.msal.ru/) — сайт откроется в тёмном интерфейсе DarkMSAL!
6. **Ярлык на экран «Домой»**: В приложении «Быстрые команды» (Shortcuts) создайте команду: *Открыть URL `https://lk.msal.ru/`* ➔ *Добавить на экран «Домой»*.

---

### 🍏 2. iOS Standalone (.ipa)
Для установки отдельного приложения вне Safari:
- Скачайте готовый `release/DarkMSAL-1.0.ipa`.
- Установите через любой sideload-менеджер: **AltStore**, **SideStore**, **Scarlet**, **TrollStore** или **LiveContainer**.

---

### 🤖 3. Android (.apk — нативное приложение, рекомендуется)
1. Скачайте APK **только из [GitHub Releases](https://github.com/manlitodubonzj75-cloud/DarkLK/releases/latest)** и сверьте SHA-256 с файлом `SHA256SUMS.txt` из того же релиза.
2. Откройте файл на смартфоне и подтвердите установку.
3. Готово! Ключ шифрования хранится в Android Keystore.

#### Альтернатива на Android (через браузер):
- В браузере **Firefox**, **Kiwi** или **Yandex Browser** установите расширение **Tampermonkey**.
- В настройках Tampermonkey ➔ **Утилиты** ➔ вставьте ссылку на скрипт (`https://github.com/manlitodubonzj75-cloud/DarkLK/releases/latest/download/darkmsal.user.js`) и нажмите «Установить».
- Либо используйте легковесный браузер **Via Browser** (Настройки ➔ Скрипты ➔ Добавить по URL).

---

### 🪟 4. Windows (.exe)
1. Скачайте установочный файл **`DarkMSAL Setup 1.0.0.exe`** из папки `release/`.
2. Запустите инсталлятор и следуйте подсказкам мастера установки.
3. Программа установится в систему и создаст ярлык на рабочем столе и в меню «Пуск».

---

### 🐧 5. Linux Fedora / RedHat / CentOS (.rpm)
1. Скачайте пакет **`darkmsal-1.0.0.x86_64.rpm`** из каталога `release/`.
2. Установите через менеджер пакетов DNF:
   ```bash
   sudo dnf install ./darkmsal-1.0.0.x86_64.rpm
   ```
3. Запустите приложение из системного меню приложений или командой `darkmsal`.

---

### 🐧 6. Linux Ubuntu / Debian (.deb)
1. Скачайте пакет **`darkmsal_1.0.0_amd64.deb`** из каталога `release/`.
2. Установите командой:
   ```bash
   sudo apt install ./darkmsal_1.0.0_amd64.deb
   ```

---

### 🐧 7. Linux Universal (.AppImage)
1. Скачайте **`DarkMSAL-1.0.0.AppImage`**.
2. Сделайте файл исполняемым и запустите:
   ```bash
   chmod +x DarkMSAL-1.0.0.AppImage
   ./DarkMSAL-1.0.0.AppImage
   ```

---

### 🍎 8. macOS (.dmg)
1. Скачайте образ **`DarkMSAL-1.0.0-arm64.dmg`** (для Apple Silicon M1/M2/M3/M4) или сборку под Intel.
2. Откройте DMG и перетащите иконку **DarkMSAL** в папку **«Программы» (Applications)**.

---

## 🛠️ Сборка дистрибутивов из исходников

### Подготовка окружения
```bash
# Клонирование репозитория
git clone git@github.com:manlitodubonzj75-cloud/DarkLK.git
cd DarkLK

# Установка Node.js зависимостей
npm install
```

### Команды сборки:

| Платформа / Цель | Команда сборки | Результирующий файл |
|:---|:---|:---|
| **Userscript** (iOS / Android / ПК) | `npm run build:userscript` | `release/darkmsal.user.js` |
| **Windows** (NSIS Installer x64) | `npm run package:win` | `release/DarkMSAL Setup 1.0.0.exe` |
| **Linux Fedora** (RPM x64) | `npm run package:fedora` | `release/darkmsal-1.0.0.x86_64.rpm` |
| **Linux All** (AppImage + RPM + DEB) | `npm run package:linux` | `release/*.AppImage`, `*.rpm`, `*.deb` |
| **macOS** (DMG) | `npm run package:mac` | `release/DarkMSAL-1.0.0-arm64.dmg` |
| **Android** (APK, нужен release-ключ, см. ниже) | `npm run package:apk` | `release/DarkMSAL-<версия>.apk` |
| **iOS** (IPA) | `npm run package:ipa` | `release/DarkMSAL-1.0.ipa` |
| **Web SPA** | `npm run build` | каталог `dist/` |

### 🔑 Подпись Android

Релизный APK подписывается одним постоянным ключом — иначе обновления не встают поверх, а пользователи привыкают ставить APK откуда попало. Ключ **никогда не коммитится**.

```bash
# один раз, хранить в надёжном месте (потеря ключа = невозможность выпускать обновления)
keytool -genkeypair -v -keystore darkmsal-release.keystore -alias darkmsal \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 darkmsal-release.keystore   # -> секрет ANDROID_KEYSTORE_BASE64
```

GitHub → Settings → Secrets and variables → Actions: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Локально — те же значения через переменные `DARKMSAL_KEYSTORE_FILE`, `DARKMSAL_KEYSTORE_PASSWORD`, `DARKMSAL_KEY_ALIAS`, `DARKMSAL_KEY_PASSWORD`.

---

## 📁 Структура проекта

```
DarkLK/
├── .github/workflows/          # CI/CD автоматической сборки мультиплатформенных релизов
├── android/                    # Нативный проект Android (Capacitor 7 + Gradle)
├── ios/                        # Нативный проект iOS (Capacitor 7 + Xcode Workspace)
├── electron/                   # Конфигурация десктопного движка Electron
├── build/                      # Иконки приложения (icon.icns, icon.ico, png)
├── public/                     # Статические ресурсы (логотипы, манифест)
├── release/                    # Скомпилированные пакеты (userscript, apk, exe, rpm, dmg)
├── src/                        # Исходный код React-приложения
│   ├── api/                    # Сетевой клиент, AES-GCM шифрование, кэш, парсеры
│   ├── components/             # Компоненты UI (Shell, дашборд, расписание, зачётка)
│   ├── context/                # React Context (авторизация, тема, синхронизация)
│   ├── hooks/                  # Адаптивность к устройствам и тач-событиям
│   └── userscript-entry.jsx    # Точка входа бандла Userscript для Safari и браузеров
├── package.json                # Скрипты сборки под все платформы
├── tailwind.config.js          # Стилизация Tailwind
└── vite.config.js              # Конфигурация сборщика Vite
```

---

## ⚖️ Правовая информация и безопасность

- **Персональные данные**: приложение не отправляет данные никуда, кроме серверов университета (`lk.msal.ru`, `mail.msal.ru`) и GitHub (проверка обновлений, без персональных данных). Всё сохранённое локально — зашифровано (см. выше).
- **Отказ от ответственности**: Приложение разработано сообществом студентов для улучшения пользовательского опыта и не является официальным продуктом Университета имени О.Е. Кутафина (МГЮА).
- **Служба поддержки**: Официальный бот в Telegram [@DarkMSAL_supportbot](https://t.me/DarkMSAL_supportbot).
- **Репозиторий проекта**: [https://github.com/manlitodubonzj75-cloud/DarkLK](https://github.com/manlitodubonzj75-cloud/DarkLK).
- **Автономный Userscript-репозиторий**: [https://github.com/manlitodubonzj75-cloud/MSALka-sova-skakalka](https://github.com/manlitodubonzj75-cloud/MSALka-sova-skakalka).
