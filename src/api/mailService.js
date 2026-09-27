/**
 * Exchange Web Services (EWS) / OWA JSON-RPC Mail API Service
 * Handles Mail folders, Conversations, Item details, and Attachment downloading.
 */
import { mailClient } from './mailClient';
import { cryptoStorage } from './cryptoStorage';
import { cacheService } from './cacheService';

export const mailService = {
  /**
   * Check if credentials or session cookies exist
   */
  isAuthenticated() {
    return mailClient.isAuthenticated();
  },

  /**
   * Check auth and perform silent auto-login if saved LK credentials exist.
   * If offline or server is temporarily unreachable, preserves authenticated status
   * so user can browse cached emails without getting logged out / ejected.
   */
  async checkAuth() {
    const cachedUser = mailClient.currentUser || localStorage.getItem('msal_mail_currentUser');

    if (mailClient.canary && cachedUser) {
      return { isAuthenticated: true, username: cachedUser };
    }

    try {
      const saved = await cryptoStorage.getSavedCredentialsAsync();
      const mailSaved = cryptoStorage.getMailCredentials();
      const username = mailSaved?.username || saved?.login;
      const password = mailSaved?.password || saved?.password;

      if (username && password) {
        try {
          await mailClient.login(username, password);
          return { isAuthenticated: true, username: mailClient.currentUser || username };
        } catch (loginErr) {
          // If offline / network error / timeout, do not eject user if saved credentials exist
          console.warn('[MailService] Login attempt encountered error (possibly offline):', loginErr.message);
          return { isAuthenticated: true, username: mailClient.currentUser || username };
        }
      }
    } catch (err) {
      console.warn('[MailService] Silent auto-auth check notice:', err.message);
    }

    const hasStoredCreds = Boolean(cryptoStorage.getMailCredentials() || cryptoStorage.getSavedCredentials()?.login);
    const hasStoredSession = Boolean(mailClient.canary || localStorage.getItem('msal_mail_cookies'));

    return {
      isAuthenticated: hasStoredCreds || hasStoredSession,
      username: cachedUser || null
    };
  },

  /**
   * Set user credentials and initialize session
   */
  async login(username, password) {
    return await mailClient.login(username, password);
  },

  /**
   * Clear session
   */
  async logout() {
    return await mailClient.logout();
  },

  /**
   * Get list of standard folders with their display metadata
   */
  async getFolders() {
    return await cacheService.withOfflineFallback('mail_folders', async () => {
      const payload = {
        __type: 'GetFolderJsonRequest:#Exchange',
        Header: {
          __type: 'JsonRequestHeaders:#Exchange',
          RequestServerVersion: 'Exchange2013'
        },
        Body: {
          __type: 'GetFolderRequest:#Exchange',
          FolderShape: {
            __type: 'FolderResponseShape:#Exchange',
            BaseShape: 'Default'
          },
          FolderIds: [
            { __type: 'DistinguishedFolderId:#Exchange', Id: 'inbox' },
            { __type: 'DistinguishedFolderId:#Exchange', Id: 'sentitems' },
            { __type: 'DistinguishedFolderId:#Exchange', Id: 'drafts' },
            { __type: 'DistinguishedFolderId:#Exchange', Id: 'deleteditems' },
            { __type: 'DistinguishedFolderId:#Exchange', Id: 'junkemail' }
          ]
        }
      };

      try {
        const res = await mailClient.serviceCall('GetFolder', payload);
        const items = res?.Body?.ResponseMessages?.Items || [];

        return items.map((it) => {
          const folder = it.Folders?.[0] || {};
          const distinguishedId = folder.DistinguishedFolderId || folder.FolderId?.Id;
          const displayName = folder.DisplayName;
          const totalCount = folder.TotalCount || 0;
          const unreadCount = folder.UnreadCount || 0;

          let icon = 'Folder';
          let localizedName = displayName;

          switch (distinguishedId) {
            case 'inbox':
              icon = 'Inbox';
              localizedName = 'Входящие';
              break;
            case 'sentitems':
              icon = 'Send';
              localizedName = 'Отправленные';
              break;
            case 'drafts':
              icon = 'FileText';
              localizedName = 'Черновики';
              break;
            case 'deleteditems':
              icon = 'Trash2';
              localizedName = 'Удалённые';
              break;
            case 'junkemail':
              icon = 'AlertOctagon';
              localizedName = 'Спам';
              break;
            default:
              break;
          }

          return {
            id: distinguishedId || folder.FolderId?.Id,
            rawFolderId: folder.FolderId?.Id,
            name: localizedName,
            unreadCount,
            totalCount,
            icon
          };
        });
      } catch (err) {
        console.warn('[MailService] Failed to load folder metadata dynamically, returning defaults:', err.message);
        return [
          { id: 'inbox', name: 'Входящие', unreadCount: 0, totalCount: 0, icon: 'Inbox' },
          { id: 'sentitems', name: 'Отправленные', unreadCount: 0, totalCount: 0, icon: 'Send' },
          { id: 'drafts', name: 'Черновики', unreadCount: 0, totalCount: 0, icon: 'FileText' },
          { id: 'deleteditems', name: 'Удалённые', unreadCount: 0, totalCount: 0, icon: 'Trash2' },
          { id: 'junkemail', name: 'Спам', unreadCount: 0, totalCount: 0, icon: 'AlertOctagon' }
        ];
      }
    });
  },

  /**
   * Helper to extract body string safely from Exchange Item
   */
  _extractItemBody(item) {
    if (!item) return '';
    if (typeof item.Body === 'string') return item.Body;
    if (item.Body?.Value) return item.Body.Value;
    if (item.UniqueBody?.Value) return item.UniqueBody.Value;
    if (item.NormalizedBody?.Value) return item.NormalizedBody.Value;
    if (item.Preview) return item.Preview;
    return '';
  },

  /**
   * Helper to extract attachments safely from Exchange Item
   */
  _extractAttachments(item) {
    const list = item?.Attachments || [];
    return list.map((att) => ({
      id: att.AttachmentId?.Id,
      name: att.Name || 'Вложение',
      contentType: att.ContentType || 'application/octet-stream',
      size: att.Size || 0,
      isInline: Boolean(att.IsInline)
    }));
  },

  /**
   * Primary: FindConversation (OWA 2013 grouped thread view)
   */
  async getConversationsByFindConversation({ folderId = 'inbox', offset = 0, limit = 50 } = {}) {
    const isDistinguished = !folderId.includes('/') && folderId.length < 30;

    const parentFolderBase = isDistinguished
      ? { __type: 'DistinguishedFolderId:#Exchange', Id: folderId }
      : { __type: 'FolderId:#Exchange', Id: folderId };

    const payload = {
      __type: 'FindConversationJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013'
      },
      Body: {
        __type: 'FindConversationRequest:#Exchange',
        ParentFolderId: {
          __type: 'TargetFolderId:#Exchange',
          BaseFolderId: parentFolderBase
        },
        Paging: {
          __type: 'IndexedPageView:#Exchange',
          BasePoint: 'Beginning',
          Offset: offset,
          MaxEntriesReturned: limit
        },
        ConversationShape: {
          __type: 'ConversationResponseShape:#Exchange',
          BaseShape: 'Default'
        }
      }
    };

    const res = await mailClient.serviceCall('FindConversation', payload);
    const conversations = res?.Body?.Conversations || res?.Body?.ResponseMessages?.Items?.[0]?.Conversations || [];

    return conversations.map((c) => {
      const convId = c.ConversationId?.Id;
      const rawItemId = c.ItemIds?.[0]?.Id || (typeof c.ItemIds?.[0] === 'string' ? c.ItemIds[0] : null) ||
                        c.GlobalItemIds?.[0]?.Id || (typeof c.GlobalItemIds?.[0] === 'string' ? c.GlobalItemIds[0] : null);
      const itemId = rawItemId || convId;
      const senders = c.UniqueSenders || c.GlobalUniqueSenders || [];
      const senderDisplay = senders[0] || 'Неизвестный отправитель';
      const snippet = c.Preview || c.UniqueBody?.Value || '';

      return {
        id: convId || itemId,
        convId: convId,
        itemId: itemId,
        subject: c.ConversationTopic || '(Без темы)',
        sender: senderDisplay,
        senders: senders,
        deliveryTime: c.LastDeliveryTime || c.GlobalLastDeliveryTime,
        hasAttachments: Boolean(c.HasAttachments || c.GlobalHasAttachments),
        unreadCount: c.UnreadCount || 0,
        isRead: (c.UnreadCount || 0) === 0,
        messageCount: c.MessageCount || 1,
        size: c.Size || 0,
        snippet: snippet.replace(/<[^>]*>?/gm, '').trim()
      };
    });
  },

  /**
   * Fallback: FindItem (Classic flat item list)
   */
  async getItemsByFindItem({ folderId = 'inbox', offset = 0, limit = 50 } = {}) {
    const isDistinguished = !folderId.includes('/') && folderId.length < 30;

    const parentFolderBase = isDistinguished
      ? { __type: 'DistinguishedFolderId:#Exchange', Id: folderId }
      : { __type: 'FolderId:#Exchange', Id: folderId };

    const payload = {
      __type: 'FindItemJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013'
      },
      Body: {
        __type: 'FindItemRequest:#Exchange',
        Traversal: 'Shallow',
        ItemShape: {
          __type: 'ItemResponseShape:#Exchange',
          BaseShape: 'Default',
          AdditionalProperties: [
            { __type: 'PropertyUri:#Exchange', FieldURI: 'item:Subject' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'item:DateTimeReceived' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'item:HasAttachments' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'message:IsRead' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'message:From' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'item:Size' }
          ]
        },
        IndexedPageItemView: {
          __type: 'IndexedPageView:#Exchange',
          BasePoint: 'Beginning',
          Offset: offset,
          MaxEntriesReturned: limit
        },
        ParentFolderIds: [
          {
            __type: 'TargetFolderId:#Exchange',
            BaseFolderId: parentFolderBase
          }
        ]
      }
    };

    const res = await mailClient.serviceCall('FindItem', payload);
    const items = res?.Body?.ResponseMessages?.Items?.[0]?.RootFolder?.Items || [];

    return items.map((it) => {
      const senderName = it.From?.Mailbox?.Name || it.Sender?.Mailbox?.Name || 'Неизвестный отправитель';
      const cleanSnippet = (it.Preview || it.UniqueBody?.Value || '').replace(/<[^>]*>?/gm, '').trim();

      return {
        id: it.ItemId?.Id,
        itemId: it.ItemId?.Id,
        convId: it.ConversationId?.Id || null,
        subject: it.Subject || '(Без темы)',
        sender: senderName,
        senders: [senderName],
        deliveryTime: it.DateTimeReceived,
        hasAttachments: Boolean(it.HasAttachments),
        unreadCount: it.IsRead ? 0 : 1,
        isRead: Boolean(it.IsRead),
        messageCount: 1,
        size: 0,
        snippet: cleanSnippet
      };
    });
  },

  /**
   * Unified method to load folder items (prioritizes FindConversation, with offline caching)
   */
  async getConversations({ folderId = 'inbox', offset = 0, limit = 50 } = {}) {
    const cacheKey = `mail_convs_${folderId}`;
    return await cacheService.withOfflineFallback(cacheKey, async () => {
      try {
        const convs = await this.getConversationsByFindConversation({ folderId, offset, limit });
        if (Array.isArray(convs) && convs.length > 0) {
          return convs;
        }
      } catch (err) {
        console.warn('[MailService] FindConversation error, trying FindItem fallback:', err.message);
      }

      try {
        return await this.getItemsByFindItem({ folderId, offset, limit });
      } catch (err2) {
        console.warn('[MailService] FindItem fallback also failed:', err2.message);
        return [];
      }
    });
  },

  /**
   * Direct GetItem call to Exchange with AllProperties shape
   */
  async _fetchSingleItem(realItemId) {
    const payload = {
      __type: 'GetItemJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013'
      },
      Body: {
        __type: 'GetItemRequest:#Exchange',
        ItemShape: {
          __type: 'ItemResponseShape:#Exchange',
          BaseShape: 'AllProperties',
          IncludeMimeContent: false
        },
        ItemIds: [
          { __type: 'ItemId:#Exchange', Id: realItemId }
        ]
      }
    };

    const res = await mailClient.serviceCall('GetItem', payload);
    const item = res?.Body?.ResponseMessages?.Items?.[0]?.Items?.[0];

    if (!item) {
      throw new Error('Письмо не найдено на сервере Exchange');
    }

    const bodyVal = this._extractItemBody(item);
    const attachments = this._extractAttachments(item);
    const toRecipients = (item.ToRecipients || []).map((r) => ({
      name: r.Name || r.EmailAddress,
      email: r.EmailAddress
    }));

    return {
      id: item.ItemId?.Id || realItemId,
      subject: item.Subject || '(Без темы)',
      from: {
        name: item.From?.Mailbox?.Name || item.Sender?.Mailbox?.Name || 'Неизвестный',
        email: item.From?.Mailbox?.EmailAddress || ''
      },
      to: toRecipients,
      dateTimeReceived: item.DateTimeReceived,
      body: bodyVal,
      hasAttachments: attachments.length > 0,
      attachments: attachments,
      isRead: Boolean(item.IsRead)
    };
  },

  /**
   * Get full email message by ItemId or ConversationId (with offline caching)
   */
  async getMessage(identifier) {
    if (!identifier) throw new Error('Идентификатор письма обязателен');
    const cacheKey = `mail_msg_${identifier}`;

    return await cacheService.withOfflineFallback(cacheKey, async () => {
      // 1. If it's a direct ItemId (starts with AAMk), fetch it directly
      if (identifier.startsWith('AAMk')) {
        try {
          const itemRes = await this._fetchSingleItem(identifier);
          if (itemRes && itemRes.body && itemRes.body.trim().length > 0) {
            return itemRes;
          }
          if (itemRes) return itemRes;
        } catch (err) {
          console.warn('[MailService] _fetchSingleItem failed for AAMk:', err.message);
        }
      }

      // 2. If it's a ConversationId (starts with AAQk) or fallback to conversation nodes
      if (identifier.startsWith('AAQk')) {
        try {
          const convRes = await this.getConversationItems(identifier);
          if (convRes && convRes.messages && convRes.messages.length > 0) {
            const msgWithBody = [...convRes.messages].reverse().find(m => m.body && m.body.trim().length > 0);
            if (msgWithBody) return msgWithBody;
            const lastMsg = convRes.messages[convRes.messages.length - 1];
            if (lastMsg?.id && lastMsg.id.startsWith('AAMk')) {
              try {
                return await this._fetchSingleItem(lastMsg.id);
              } catch (_) {}
            }
            return lastMsg;
          }
        } catch (convErr) {
          console.warn('[MailService] GetConversationItems failed:', convErr.message);
        }
      }

      // 3. Fallback: try calling _fetchSingleItem with whatever ID was provided
      return await this._fetchSingleItem(identifier);
    });
  },

  /**
   * Get all messages in a Conversation thread
   */
  async getConversationItems(conversationId) {
    const payload = {
      __type: 'GetConversationItemsJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013'
      },
      Body: {
        __type: 'GetConversationItemsRequest:#Exchange',
        ItemShape: {
          __type: 'ItemResponseShape:#Exchange',
          BaseShape: 'AllProperties',
          IncludeMimeContent: false
        },
        Conversations: [
          {
            __type: 'ConversationRequestType:#Exchange',
            ConversationId: {
              __type: 'ItemId:#Exchange',
              Id: conversationId
            }
          }
        ]
      }
    };

    const res = await mailClient.serviceCall('GetConversationItems', payload);
    const convNode = res?.Body?.ResponseMessages?.Items?.[0]?.Conversation;
    const conversationNodes = convNode?.ConversationNodes || [];

    const messages = [];
    for (const node of conversationNodes) {
      const items = node.Items || [];
      for (const item of items) {
        messages.push({
          id: item.ItemId?.Id,
          subject: item.Subject || convNode?.ConversationTopic || '(Без темы)',
          from: {
            name: item.From?.Mailbox?.Name || item.Sender?.Mailbox?.Name || 'Неизвестный',
            email: item.From?.Mailbox?.EmailAddress || ''
          },
          dateTimeReceived: item.DateTimeReceived,
          body: this._extractItemBody(item),
          hasAttachments: Boolean(item.HasAttachments),
          attachments: this._extractAttachments(item),
          isRead: Boolean(item.IsRead)
        });
      }
    }

    return {
      conversationId: convNode?.ConversationId?.Id || conversationId,
      topic: convNode?.ConversationTopic || '(Без темы)',
      messages
    };
  },

  /**
   * Send new email
   */
  async sendEmail({ to, subject, body, isHtml = true }) {
    const toRecipients = Array.isArray(to) ? to : [to];
    const toAddresses = toRecipients.map((email) => ({
      Mailbox: {
        __type: 'EmailAddressType:#Exchange',
        EmailAddress: email.trim()
      }
    }));

    const payload = {
      __type: 'CreateItemJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013'
      },
      Body: {
        __type: 'CreateItemRequest:#Exchange',
        MessageDisposition: 'SendAndSaveCopy',
        SavedItemFolderId: {
          __type: 'TargetFolderId:#Exchange',
          BaseFolderId: {
            __type: 'DistinguishedFolderId:#Exchange',
            Id: 'sentitems'
          }
        },
        Items: [
          {
            __type: 'Message:#Exchange',
            Subject: subject || '(Без темы)',
            Body: {
              __type: 'BodyContentType:#Exchange',
              BodyType: isHtml ? 'HTML' : 'Text',
              Value: isHtml ? (body.includes('<') ? body : `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px;">${body.replace(/\n/g, '<br/>')}</div>`) : (body || '')
            },
            ToRecipients: toAddresses
          }
        ]
      }
    };

    return await mailClient.serviceCall('CreateItem', payload);
  },

  /**
   * Move item to Deleted Items
   */
  async deleteItem(itemId) {
    if (!itemId) throw new Error('itemId обязателен');

    const payload = {
      __type: 'DeleteItemJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013'
      },
      Body: {
        __type: 'DeleteItemRequest:#Exchange',
        DeleteType: 'MoveToDeletedItems',
        ItemIds: [
          { __type: 'ItemId:#Exchange', Id: itemId }
        ]
      }
    };

    return await mailClient.serviceCall('DeleteItem', payload);
  },

  /**
   * Download attachment by AttachmentId
   */
  async getAttachment(attachmentId, fileName, contentType) {
    return await mailClient.downloadAttachment(attachmentId, fileName, contentType);
  }
};

export default mailService;
