/**
 * DarkMSAL - OWA / Exchange 2016 Mail Service
 *
 * Implements high-level email operations:
 * - Session & Credentials Management
 * - Folder navigation (Входящие, Отправленные, Черновики, Корзина, Спам)
 * - Conversation listing (FindConversation)
 * - Email detail reader (GetItem)
 * - Sending new messages (CreateItem)
 * - Deleting & marking as read
 */

import { mailClient } from './mailClient.js';

const DISTINGUISHED_FOLDERS = [
  { id: 'inbox', name: 'Входящие', icon: 'Inbox' },
  { id: 'sentitems', name: 'Отправленные', icon: 'Send' },
  { id: 'drafts', name: 'Черновики', icon: 'FileText' },
  { id: 'deleteditems', name: 'Удалённые', icon: 'Trash2' },
  { id: 'junkemail', name: 'Спам', icon: 'AlertOctagon' },
  { id: 'archive', name: 'Архив', icon: 'Archive' }
];

export const mailService = {
  /**
   * Check if user is authenticated with mail
   */
  async checkAuth() {
    const creds = await mailClient.getStoredCredentials();
    return {
      isAuthenticated: Boolean(creds?.username),
      username: creds?.username || null
    };
  },

  /**
   * Log into Exchange OWA
   */
  async login(username, password) {
    return await mailClient.login(username, password);
  },

  /**
   * Logout and clear local credentials
   */
  async logout() {
    await mailClient.logout();
  },

  /**
   * Retrieve list of mail folders
   */
  async getFolders() {
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
          BaseShape: 'AllProperties'
        },
        FolderIds: [
          {
            __type: 'DistinguishedFolderId:#Exchange',
            Id: 'msgfolderroot'
          }
        ]
      }
    };

    try {
      const res = await mailClient.serviceCall('GetFolder', payload);
      const rootFolder = res?.Body?.ResponseMessages?.Items?.[0]?.Folders?.[0];

      // Return default distinguished folders with fallback
      return DISTINGUISHED_FOLDERS.map((f) => ({
        id: f.id,
        name: f.name,
        icon: f.icon,
        unreadCount: f.id === 'inbox' ? (rootFolder?.UnreadCount || 0) : 0,
        totalCount: f.id === 'inbox' ? (rootFolder?.TotalCount || 0) : 0
      }));
    } catch (err) {
      console.warn('[MailService] GetFolder failed, falling back to standard list:', err.message);
      return DISTINGUISHED_FOLDERS.map((f) => ({ ...f, unreadCount: 0, totalCount: 0 }));
    }
  },

  /**
   * Get conversations in a specific folder (FindConversation)
   */
  async getConversations({ folderId = 'inbox', offset = 0, limit = 20 } = {}) {
    const isDistinguished = !folderId.includes('/') && folderId.length < 30;

    const parentFolderBase = isDistinguished
      ? { __type: 'DistinguishedFolderId:#Exchange', Id: folderId }
      : { __type: 'FolderId:#Exchange', Id: folderId };

    const payload = {
      __type: 'FindConversationJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013',
        TimeZoneContext: {
          __type: 'TimeZoneContext:#Exchange',
          TimeZoneDefinition: {
            __type: 'TimeZoneDefinitionType:#Exchange',
            Id: 'UTC'
          }
        }
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
    const conversations = res?.Body?.Conversations || [];

    return conversations.map((c) => {
      const convId = c.ConversationId?.Id;
      const itemId = c.ItemIds?.[0]?.Id || c.GlobalItemIds?.[0]?.Id;
      const senders = c.UniqueSenders || c.GlobalUniqueSenders || [];
      const senderDisplay = senders[0] || 'Неизвестный отправитель';

      return {
        id: convId,
        itemId: itemId,
        subject: c.ConversationTopic || '(Без темы)',
        sender: senderDisplay,
        senders: senders,
        deliveryTime: c.LastDeliveryTime || c.GlobalLastDeliveryTime,
        hasAttachments: Boolean(c.HasAttachments || c.GlobalHasAttachments),
        unreadCount: c.UnreadCount || 0,
        isRead: (c.UnreadCount || 0) === 0,
        messageCount: c.MessageCount || 1,
        size: c.Size || c.GlobalSize || 0
      };
    });
  },

  /**
   * Get full email message by ItemId (GetItem)
   */
  async getMessage(itemId) {
    if (!itemId) throw new Error('itemId обязателен');

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
          {
            __type: 'ItemId:#Exchange',
            Id: itemId
          }
        ]
      }
    };

    const res = await mailClient.serviceCall('GetItem', payload);
    const item = res?.Body?.ResponseMessages?.Items?.[0]?.Items?.[0];
    if (!item) {
      throw new Error('Письмо не найдено');
    }

    const fromMailbox = item.From?.Mailbox || {};
    const fromSender = {
      name: fromMailbox.Name || fromMailbox.EmailAddress || 'Неизвестно',
      email: fromMailbox.EmailAddress || ''
    };

    const toRecipients = (item.ToRecipients || []).map((r) => ({
      name: r.Name || r.EmailAddress || '',
      email: r.EmailAddress || ''
    }));

    const ccRecipients = (item.CcRecipients || []).map((r) => ({
      name: r.Name || r.EmailAddress || '',
      email: r.EmailAddress || ''
    }));

    const attachments = (item.Attachments || []).map((att) => ({
      id: att.AttachmentId?.Id,
      name: att.Name || 'Вложение',
      size: att.Size || 0,
      contentType: att.ContentType || 'application/octet-stream',
      isInline: Boolean(att.IsInline)
    }));

    const bodyVal = item.Body?.Value || '';
    const bodyType = item.Body?.BodyType || 'HTML';

    return {
      id: item.ItemId?.Id,
      changeKey: item.ItemId?.ChangeKey,
      subject: item.Subject || '(Без темы)',
      from: fromSender,
      to: toRecipients,
      cc: ccRecipients,
      dateTimeReceived: item.DateTimeReceived,
      dateTimeSent: item.DateTimeSent,
      hasAttachments: Boolean(item.HasAttachments),
      attachments,
      isRead: Boolean(item.IsRead),
      importance: item.Importance || 'Normal',
      body: bodyVal,
      bodyType: bodyType
    };
  },

  /**
   * Send a new email message (CreateItem with SendAndSaveCopy)
   */
  async sendEmail({ to, cc = [], subject = '', body = '', isHtml = true }) {
    if (!to) throw new Error('Укажите получателя (Кому)');

    const toList = Array.isArray(to) ? to : to.split(/[,;]/).map((e) => e.trim()).filter(Boolean);
    const ccList = Array.isArray(cc) ? cc : cc.split(/[,;]/).map((e) => e.trim()).filter(Boolean);

    const toRecipients = toList.map((addr) => ({
      __type: 'Mailbox:#Exchange',
      EmailAddress: addr,
      RoutingType: 'SMTP'
    }));

    const ccRecipients = ccList.map((addr) => ({
      __type: 'Mailbox:#Exchange',
      EmailAddress: addr,
      RoutingType: 'SMTP'
    }));

    const payload = {
      __type: 'CreateItemJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013',
        TimeZoneContext: {
          __type: 'TimeZoneContext:#Exchange',
          TimeZoneDefinition: {
            __type: 'TimeZoneDefinitionType:#Exchange',
            Id: 'UTC'
          }
        }
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
            ItemClass: 'IPM.Note',
            Subject: subject,
            Body: {
              __type: 'BodyType:#Exchange',
              BodyType: isHtml ? 'HTML' : 'Text',
              Value: isHtml ? (body.includes('<') ? body : `<div style="font-family: sans-serif; font-size: 14px;">${body.replace(/\n/g, '<br/>')}</div>`) : body
            },
            ToRecipients: toRecipients,
            CcRecipients: ccRecipients
          }
        ]
      }
    };

    const res = await mailClient.serviceCall('CreateItem', payload);
    return res;
  },

  /**
   * Delete an item (move to Deleted Items or permanently)
   */
  async deleteItem(itemId, deleteType = 'MoveToDeletedItems') {
    if (!itemId) throw new Error('itemId обязателен для удаления');

    const payload = {
      __type: 'DeleteItemJsonRequest:#Exchange',
      Header: {
        __type: 'JsonRequestHeaders:#Exchange',
        RequestServerVersion: 'Exchange2013'
      },
      Body: {
        __type: 'DeleteItemRequest:#Exchange',
        DeleteType: deleteType,
        ItemIds: [
          {
            __type: 'ItemId:#Exchange',
            Id: itemId
          }
        ]
      }
    };

    return await mailClient.serviceCall('DeleteItem', payload);
  }
};
