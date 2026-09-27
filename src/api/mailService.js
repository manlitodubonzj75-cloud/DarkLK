/**
 * DarkMSAL - OWA Service Layer (Exchange 2016 API)
 *
 * Implements high-level email operations over JSON-RPC:
 * - getFolders(): Inbox, Sent, Drafts, Deleted Items
 * - getConversations(): modern conversation grouping with FindItem fallback
 * - getMessage(): retrieve full email details, HTML body, attachments
 * - sendEmail(): compose and send messages
 * - deleteItem(): move to trash or purge
 */

import { mailClient } from './mailClient.js';

export const DISTINGUISHED_FOLDERS = [
  { id: 'inbox', name: 'Входящие', icon: 'Inbox' },
  { id: 'sentitems', name: 'Отправленные', icon: 'Send' },
  { id: 'drafts', name: 'Черновики', icon: 'FileText' },
  { id: 'deleteditems', name: 'Удалённые', icon: 'Trash2' },
  { id: 'junkemail', name: 'Нежелательные', icon: 'AlertOctagon' }
];

export const mailService = {
  /**
   * Log into Exchange OWA
   */
  async login(username, password) {
    return mailClient.login(username, password);
  },

  /**
   * Log out from Exchange OWA
   */
  async logout() {
    return mailClient.logout();
  },

  /**
   * Check if current session is authenticated
   */
  async checkAuth() {
    const creds = await mailClient.getStoredCredentials();
    if (!creds?.username) {
      return { isAuthenticated: false, username: null };
    }

    if (!mailClient.canary) {
      try {
        await mailClient.reauthenticate();
      } catch (_) {
        return { isAuthenticated: false, username: creds.username };
      }
    }

    return {
      isAuthenticated: Boolean(mailClient.canary),
      username: creds.username
    };
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
   * Modern OWA Conversation View (FindConversation)
   */
  async getConversationsByFindConversation({ folderId = 'inbox', offset = 0, limit = 25 } = {}) {
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
        id: convId || itemId,
        itemId: itemId || convId,
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
   * Universal Item View (FindItem)
   */
  async getItemsByFindItem({ folderId = 'inbox', offset = 0, limit = 25 } = {}) {
    const isDistinguished = !folderId.includes('/') && folderId.length < 30;
    const parentFolderBase = isDistinguished
      ? { __type: 'DistinguishedFolderId:#Exchange', Id: folderId }
      : { __type: 'FolderId:#Exchange', Id: folderId };

    const payload = {
      __type: 'FindItemJsonRequest:#Exchange',
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
        __type: 'FindItemRequest:#Exchange',
        Traversal: 'Shallow',
        ItemShape: {
          __type: 'ItemResponseShape:#Exchange',
          BaseShape: 'IdOnly',
          AdditionalProperties: [
            { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemSubject' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemDateTimeReceived' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemHasAttachments' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'MessageFrom' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'MessageIsRead' },
            { __type: 'PropertyUri:#Exchange', FieldURI: 'ItemSize' }
          ]
        },
        ParentFolderIds: [parentFolderBase],
        IndexedPageItemView: {
          __type: 'IndexedPageView:#Exchange',
          BasePoint: 'Beginning',
          Offset: offset,
          MaxEntriesReturned: limit
        }
      }
    };

    const res = await mailClient.serviceCall('FindItem', payload);
    const items = res?.Body?.ResponseMessages?.Items?.[0]?.RootFolder?.Items || [];

    return items.map((item) => {
      const itemId = item.ItemId?.Id;
      const fromMailbox = item.From?.Mailbox || {};
      const senderDisplay = fromMailbox.Name || fromMailbox.EmailAddress || 'Неизвестный отправитель';

      return {
        id: itemId,
        itemId: itemId,
        subject: item.Subject || '(Без темы)',
        sender: senderDisplay,
        senders: [senderDisplay],
        deliveryTime: item.DateTimeReceived,
        hasAttachments: Boolean(item.HasAttachments),
        unreadCount: item.IsRead ? 0 : 1,
        isRead: Boolean(item.IsRead),
        messageCount: 1,
        size: item.Size || 0
      };
    });
  },

  /**
   * Get messages / conversations with resilient automatic fallback
   */
  async getConversations({ folderId = 'inbox', offset = 0, limit = 25 } = {}) {
    try {
      const convs = await this.getConversationsByFindConversation({ folderId, offset, limit });
      if (Array.isArray(convs) && convs.length > 0) {
        return convs;
      }
    } catch (err) {
      console.warn('[MailService] FindConversation failed, trying FindItem fallback:', err.message);
    }

    return this.getItemsByFindItem({ folderId, offset, limit });
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
