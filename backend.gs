
/**
 * @OnlyCurrentDoc
 */
/**
 * Moderated threaded comments backend for the article site.
 *
 * Deploy this file as a Google Apps Script web app attached to its own
 * spreadsheet. The script creates or uses a sheet named "Comments".
 *
 * Reader submissions are always stored as PENDING. Only rows whose status is
 * APPROVED are returned by doGet. To add one of icely's own appendixes, add a
 * row to the "Appendix" sheet (articleSlug, body) where body is article
 * markdown: everything 0_manage_articles.py understands, including tooltips,
 * censor bars, spoilers, colours, text effects, slideshows and youtube[...],
 * because the comments app renders it with a port of that same helper.
 * Appendixes are per-article content returned as markdown in doGet's
 * appendixMarkdown field (appendixHtml carries a simpleMarkdownToHtml_
 * rendering of it, used only by a client that cannot run the port); they are
 * not comments and cannot be replied to. Author comments (a separate feature) can instead be
 * added with addAuthorComment() or as a Comments row with kind=AUTHOR,
 * status=APPROVED.
 *
 * Columns:
 *   id, createdAt, articleSlug, parentId, username, body, kind, status,
 *   moderatedAt, moderatorNote, clientId, editBody, editStatus, editAt
 */

const COMMENTS_SHEET_NAME = 'Comments';
const COMMENTS_HEADERS = [
  'id', 'createdAt', 'articleSlug', 'parentId', 'username', 'body', 'kind',
  'status', 'moderatedAt', 'moderatorNote', 'clientId', 'editBody',
  'editStatus', 'editAt'
];
const DRAFTS_SHEET_NAME = 'Drafts';
const DRAFTS_HEADERS = [
  'id', 'createdAt', 'articleSlug', 'parentId', 'username', 'body', 'clientId',
  'commentId', 'draftType'
];
const BANNED_WORDS_SHEET_NAME = 'BannedWords';
const APPENDIX_SHEET_NAME = 'Appendix';
const APPENDIX_HEADERS = ['articleSlug', 'body'];
const APPROVED = 'APPROVED';
const PENDING = 'PENDING';
const REJECTED = 'REJECTED';
const DELETED = 'DELETED';
const MAX_USERNAME_LENGTH = 80;
const MAX_BODY_LENGTH = 50000;
const MAX_APPENDIX_LENGTH = 50000;
const MAX_ARTICLE_SLUG_LENGTH = 160;
const MAX_COMMENT_DEPTH = 12;

function doGet(e) {
  try {
    const action = String((e && e.parameter && e.parameter.action) || 'list').toLowerCase();
    const callback = e && e.parameter && e.parameter.callback;
    const rows = readRows_();

    if (action === 'counts') {
      const counts = {};
      rows.forEach(function (row) {
        if (row.status !== APPROVED) return;
        counts[row.articleSlug] = (counts[row.articleSlug] || 0) + 1;
      });
      return respond_({ ok: true, counts: counts }, callback);
    }

    if (action === 'recent') {
      const requestedLimit = Number(e.parameter.limit || 100);
      const limit = Math.max(1, Math.min(100, isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100));
      const comments = rows
        .filter(function (row) { return row.status === APPROVED; })
        .sort(function (a, b) {
          return dateNumber_(b.createdAt) - dateNumber_(a.createdAt);
        })
        .slice(0, limit)
        .map(function (row) {
          const comment = publicComment_(row, '', hasReplies_(rows, row.id));
          comment.articleSlug = row.articleSlug;
          return comment;
        });
      return respond_({ ok: true, comments: comments }, callback);
    }

    if (action !== 'list') throw new Error('Unknown action.');

    const articleSlug = cleanText_(e.parameter.article || '', MAX_ARTICLE_SLUG_LENGTH);
    if (!articleSlug) throw new Error('An article slug is required.');

    const viewerClientId = cleanText_(e.parameter.clientId || '', 160);
    const comments = rows
      .filter(function (row) {
        if (row.articleSlug !== articleSlug) return false;
        if (row.status === APPROVED) return true;
        return row.status === PENDING && !!viewerClientId && row.clientId === viewerClientId;
      })
      .map(function (row) {
        return publicComment_(row, viewerClientId, hasReplies_(rows, row.id));
      })
      .sort(function (a, b) {
        return String(a.createdAt).localeCompare(String(b.createdAt));
      });
    const appendixMarkdown = appendixMarkdown_(articleSlug);

    return respond_({
      ok: true,
      comments: comments,
      // The app renders this markdown itself, with a port of the article
      // generator's own helper (comments/markdown.js), so an appendix gets the
      // full article syntax. appendixHtml is the fallback for a client that
      // could not load that file, so it is still sent.
      appendixMarkdown: appendixMarkdown,
      appendixHtml: simpleMarkdownToHtml_(appendixMarkdown)
    }, e.parameter.callback);
  } catch (error) {
    return respond_({ ok: false, error: safeError_(error) }, e && e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = String(payload.action || '').toLowerCase();
    if (action !== 'submit' && action !== 'draft' && action !== 'edit' && action !== 'delete') {
      throw new Error('Unknown action.');
    }

    if (action === 'delete') {
      const articleSlug = cleanText_(payload.articleSlug || '', MAX_ARTICLE_SLUG_LENGTH);
      const commentId = cleanText_(payload.commentId || payload.id || '', 100);
      const clientId = cleanText_(payload.clientId || '', 160);
      if (!articleSlug || !commentId || !clientId) {
        throw new Error('A comment, article, and client are required.');
      }
      const rows = readRows_();
      const row = rows.filter(function (candidate) { return candidate.id === commentId; })[0];
      if (!row || row.articleSlug !== articleSlug || row.kind === 'AUTHOR' || row.clientId !== clientId) {
        throw new Error('That comment cannot be changed by this client.');
      }
      if (row.status === DELETED) {
        return respond_({ ok: true, status: DELETED, id: row.id });
      }
      if (row.status !== APPROVED && row.status !== PENDING) {
        throw new Error('That comment is no longer available.');
      }
      if (hasReplies_(rows, row.id)) {
        throw new Error('Comments with replies cannot be deleted.');
      }
      setCommentField_(getCommentsSheet_(), row.sheetRow, 'status', DELETED);
      setCommentField_(getCommentsSheet_(), row.sheetRow, 'moderatedAt', new Date());
      return respond_({ ok: true, status: DELETED, id: row.id });
    }

    // The hidden field is a cheap bot filter. It is not a moderation mechanism.
    if (cleanText_(payload.website || '', 200)) {
      throw new Error('Submission rejected.');
    }

    const articleSlug = cleanText_(payload.articleSlug || '', MAX_ARTICLE_SLUG_LENGTH);
    const parentId = cleanText_(payload.parentId || '', 100);
    const username = cleanText_(payload.username || '', MAX_USERNAME_LENGTH);
    const body = cleanText_(payload.body || '', MAX_BODY_LENGTH);
    const clientId = cleanText_(payload.clientId || '', 160);
    const commentId = cleanText_(payload.commentId || payload.id || '', 100);

    if (action === 'draft') {
      if (!articleSlug) throw new Error('An article slug is required.');
      if (!username && !body) throw new Error('Nothing to save.');
      const draftId = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
      getDraftsSheet_().appendRow([
        safeSheetText_(draftId),
        new Date(),
        safeSheetText_(articleSlug),
        safeSheetText_(parentId),
        safeSheetText_(username),
        safeSheetText_(bodyHasBannedWord_(body) ? rot13_(body) : body),
        safeSheetText_(clientId),
        safeSheetText_(commentId),
        safeSheetText_(cleanText_(payload.draftType || 'COMPOSE', 20).toUpperCase())
      ]);
      return respond_({ ok: true });
    }

    if (action === 'edit') {
      if (!articleSlug || !commentId || !clientId) {
        throw new Error('A comment, article, and client are required.');
      }

      const rows = readRows_();
      const row = rows.filter(function (candidate) {
        return candidate.id === commentId;
      })[0];
      if (!row || row.articleSlug !== articleSlug || row.kind === 'AUTHOR' || row.clientId !== clientId) {
        throw new Error('That comment cannot be changed by this client.');
      }
      if (row.status !== APPROVED && row.status !== PENDING) {
        throw new Error('That comment is no longer available.');
      }
      if (hasReplies_(rows, row.id)) {
        throw new Error('Comments with replies cannot be edited.');
      }

      const sheet = getCommentsSheet_();
      if (!body) throw new Error('Comment text is required.');
      const storedBody = bodyHasBannedWord_(body) ? rot13_(body) : body;
      if (row.status === PENDING) {
        setCommentField_(sheet, row.sheetRow, 'body', storedBody);
      } else {
        // Keep the currently public body in place while the edited body waits
        // for approval. If the previous edit was approved, promote it first.
        if (row.editStatus === APPROVED && row.editBody) {
          setCommentField_(sheet, row.sheetRow, 'body', row.editBody);
        }
        setCommentField_(sheet, row.sheetRow, 'editBody', storedBody);
        setCommentField_(sheet, row.sheetRow, 'editStatus', PENDING);
        setCommentField_(sheet, row.sheetRow, 'editAt', new Date());
      }
      return respond_({ ok: true, status: row.status, editStatus: PENDING, id: row.id });
    }

    if (!articleSlug || !username || !body) throw new Error('Username, article, and comment are required.');

    const rows = readRows_();
    const byId = {};
    rows.forEach(function (row) { if (row.id) byId[row.id] = row; });

    if (parentId) {
      const parent = byId[parentId];
      if (!parent || parent.articleSlug !== articleSlug || parent.status !== APPROVED) {
        throw new Error('That comment cannot receive replies.');
      }
      if (commentDepth_(byId, parentId) >= MAX_COMMENT_DEPTH) {
        throw new Error('This thread is too deep for another reply.');
      }
    }

    // This is deliberately not a public kind field. Readers can only create
    // reader comments; author comments are added manually by the site owner.
    const existing = commentId ? rows.filter(function (row) { return row.id === commentId; })[0] : null;
    if (existing) {
      if (existing.articleSlug !== articleSlug || existing.clientId !== clientId) {
        throw new Error('That comment ID is already in use.');
      }
      return respond_({ ok: true, status: existing.status, id: existing.id });
    }
    const id = commentId || Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    const now = new Date();
    const sheet = getCommentsSheet_();
    sheet.appendRow([
      safeSheetText_(id),
      now,
      safeSheetText_(articleSlug),
      safeSheetText_(parentId),
      safeSheetText_(username),
      safeSheetText_(bodyHasBannedWord_(body) ? rot13_(body) : body),
      'READER',
      PENDING,
      '',
      '',
      safeSheetText_(clientId),
      '',
      '',
      ''
    ]);

    return respond_({ ok: true, status: PENDING, id: id });
  } catch (error) {
    return respond_({ ok: false, error: safeError_(error) });
  } finally {
    try { lock.releaseLock(); } catch (error) {}
  }
}

/**
 * Convenience helper for adding an approved first-party appendix comment.
 * Run this manually in Apps Script, for example:
 * addAuthorComment('when-can-you-no-longer-believe-in-utopia', 'A note from me.');
 */
function addAuthorComment(articleSlug, body, parentId, username) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const slug = cleanText_(articleSlug || '', MAX_ARTICLE_SLUG_LENGTH);
    const text = cleanText_(body || '', MAX_BODY_LENGTH);
    const parent = cleanText_(parentId || '', 100);
    const name = cleanText_(username || 'icely', MAX_USERNAME_LENGTH) || 'icely';
    if (!slug || !text) throw new Error('Article slug and body are required.');

    const rows = readRows_();
    const byId = {};
    rows.forEach(function (row) { if (row.id) byId[row.id] = row; });
    if (parent) {
      const parentRow = byId[parent];
      if (!parentRow || parentRow.articleSlug !== slug || parentRow.status !== APPROVED) {
        throw new Error('That comment cannot receive replies.');
      }
      if (commentDepth_(byId, parent) >= MAX_COMMENT_DEPTH) {
        throw new Error('This thread is too deep for another reply.');
      }
    }

    const id = Utilities.getUuid().replace(/-/g, '').slice(0, 24);
    const now = new Date();
    getCommentsSheet_().appendRow([
      safeSheetText_(id), now, safeSheetText_(slug), safeSheetText_(parent),
      safeSheetText_(name), safeSheetText_(text), 'AUTHOR', APPROVED, now, '', '',
      '', '', ''
    ]);
    return id;
  } finally {
    try { lock.releaseLock(); } catch (error) {}
  }
}

function getCommentsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(COMMENTS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(COMMENTS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, COMMENTS_HEADERS.length).setValues([COMMENTS_HEADERS]);
  } else {
    ensureHeaders_(sheet, COMMENTS_HEADERS);
  }
  return sheet;
}

function readRows_() {
  const sheet = getCommentsSheet_();
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];

  const headers = values[0].map(function (value) { return String(value).trim(); });
  return values.slice(1).map(function (row, index) {
    const result = {};
    headers.forEach(function (header, index) {
      if (header) result[header] = row[index];
    });
    return {
      id: cleanText_(result.id || '', 100),
      createdAt: result.createdAt || '',
      articleSlug: cleanText_(result.articleSlug || '', MAX_ARTICLE_SLUG_LENGTH),
      parentId: cleanText_(result.parentId || '', 100),
      username: cleanText_(result.username || '', MAX_USERNAME_LENGTH),
      body: cleanText_(result.body || '', MAX_BODY_LENGTH),
      kind: cleanText_(result.kind || 'READER', 20).toUpperCase(),
      status: cleanText_(result.status || '', 20).toUpperCase(),
      moderatedAt: result.moderatedAt || '',
      moderatorNote: cleanText_(result.moderatorNote || '', 1000),
      clientId: cleanText_(result.clientId || '', 160),
      editBody: cleanText_(result.editBody || '', MAX_BODY_LENGTH),
      editStatus: cleanText_(result.editStatus || '', 20).toUpperCase(),
      editAt: result.editAt || '',
      sheetRow: index + 2
    };
  // Keep tombstones and blank-body rows available for mutation lookups.
  // Public readers already filter by status before returning comment bodies.
  }).filter(function (row) { return row.id && row.articleSlug; });
}

function publicComment_(row, viewerClientId, hasReplies) {
  const approvedEdit = row.status === APPROVED && row.editStatus === APPROVED && row.editBody;
  const pendingEdit = row.status === APPROVED && row.editStatus === PENDING &&
    row.editBody && row.clientId === viewerClientId;
  const editedBody = approvedEdit || pendingEdit ? row.editBody : row.body;
  return {
    id: row.id,
    parentId: row.parentId,
    username: row.username || 'Anonymous',
    body: editedBody,
    kind: row.status === PENDING ? 'PENDING' : (row.kind === 'AUTHOR' ? 'AUTHOR' : 'READER'),
    createdAt: isoDate_(row.createdAt),
    canEdit: row.kind !== 'AUTHOR' && row.clientId === viewerClientId && !hasReplies,
    edited: !!(approvedEdit || pendingEdit),
    editPending: !!pendingEdit
  };
}

function hasReplies_(rows, commentId) {
  return rows.some(function (row) {
    return row.parentId === commentId && row.status !== DELETED;
  });
}

function ensureHeaders_(sheet, headers) {
  const width = Math.max(sheet.getLastColumn(), headers.length);
  const current = sheet.getRange(1, 1, 1, width).getValues()[0];
  headers.forEach(function (header, index) {
    if (String(current[index] || '').trim() !== header) {
      sheet.getRange(1, index + 1).setValue(header);
    }
  });
}

function setCommentField_(sheet, rowNumber, header, value) {
  const width = Math.max(sheet.getLastColumn(), COMMENTS_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(function (item) {
    return String(item || '').trim();
  });
  const index = headers.indexOf(header);
  if (index < 0) throw new Error('Missing comments column: ' + header);
  sheet.getRange(rowNumber, index + 1).setValue(value instanceof Date ? value : safeSheetText_(value));
}

function commentDepth_(byId, commentId) {
  let depth = 0;
  const seen = {};
  let current = commentId;
  while (current) {
    if (seen[current]) throw new Error('Invalid comment thread.');
    seen[current] = true;
    const row = byId[current];
    if (!row) break;
    depth += 1;
    current = row.parentId;
    if (depth > MAX_COMMENT_DEPTH + 1) throw new Error('This thread is too deep.');
  }
  return depth;
}

function cleanText_(value, maxLength) {
  const text = String(value == null ? '' : value).replace(/\u0000/g, '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function safeSheetText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function getAppendixSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(APPENDIX_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(APPENDIX_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, APPENDIX_HEADERS.length).setValues([APPENDIX_HEADERS]);
  }
  return sheet;
}

function appendixMarkdown_(articleSlug) {
  const sheet = getAppendixSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  const values = sheet.getRange(2, 1, lastRow, APPENDIX_HEADERS.length).getValues();
  const target = String(articleSlug || '').toLowerCase();
  const parts = [];
  values.forEach(function (row) {
    const slug = cleanText_(row[0] || '', MAX_ARTICLE_SLUG_LENGTH).toLowerCase();
    const body = cleanText_(row[1] || '', MAX_APPENDIX_LENGTH);
    if (!target || slug !== target || !body) return;
    parts.push(body);
  });
  if (!parts.length) return '';
  return parts.join('\n\n');
}

function simpleMarkdownToHtml_(text) {
  const input = String(text == null ? '' : text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  if (!input.trim()) return '';

  const lines = input.split('\n');
  let html = '';
  let para = [];
  let inCode = false;
  let codeLines = [];
  let listType = '';
  let listItems = [];
  let quoteLines = [];

  function flushPara() {
    if (para.length) {
      html += '<p>' + inlineFormat_(htmlEscape_(para.join('\n'))) + '</p>\n';
      para = [];
    }
  }

  function flushList() {
    if (!listItems.length) return;
    html += '<' + listType + '>\n' + listItems.map(function (item) {
      return '<li>' + inlineFormat_(htmlEscape_(item)) + '</li>\n';
    }).join('') + '</' + listType + '>\n';
    listItems = [];
    listType = '';
  }

  function flushQuote() {
    if (!quoteLines.length) return;
    html += '<blockquote>' + quoteLines.map(function (line) {
      return '<p>' + inlineFormat_(htmlEscape_(line)) + '</p>';
    }).join('') + '</blockquote>\n';
    quoteLines = [];
  }

  function flushAll() {
    flushPara();
    flushList();
    flushQuote();
  }

  lines.forEach(function (line) {
    if (/^```/.test(line)) {
      if (inCode) {
        html += '<pre><code>' + htmlEscape_(codeLines.join('\n')) + '</code></pre>\n';
        codeLines = [];
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      html += '<h' + level + '>' + inlineFormat_(htmlEscape_(heading[2])) + '</h' + level + '>\n';
      return;
    }

    if (/^\s*(?:---|\*\*\*)\s*$/.test(line)) {
      flushAll();
      html += '<hr>\n';
      return;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushPara();
      flushList();
      quoteLines.push(quote[1]);
      return;
    }
    flushQuote();

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushPara();
      const type = bullet ? 'ul' : 'ol';
      if (listType !== type) flushList();
      listType = type;
      listItems.push((bullet ? bullet[1] : numbered[1]).trim());
      return;
    }
    flushList();

    if (!line.trim()) {
      flushPara();
      return;
    }

    para.push(line);
  });

  if (inCode) {
    html += '<pre><code>' + htmlEscape_(codeLines.join('\n')) + '</code></pre>\n';
  }
  flushAll();
  return html;
}

function inlineFormat_(text) {
  let value = String(text == null ? '' : text);
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  value = value.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return value;
}

function htmlEscape_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getDraftsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(DRAFTS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(DRAFTS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, DRAFTS_HEADERS.length).setValues([DRAFTS_HEADERS]);
  } else {
    ensureHeaders_(sheet, DRAFTS_HEADERS);
  }
  return sheet;
}

function getBannedWordsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(BANNED_WORDS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(BANNED_WORDS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1).setValue('banned words (rot10), semicolon separated');
  }
  return sheet;
}

function bannedWords_() {
  const sheet = getBannedWordsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const words = [];
  values.forEach(function (row) {
    String(row[0] || '').split(';').forEach(function (part) {
      const word = cleanText_(part, 200).toLowerCase();
      if (word) words.push(word);
    });
  });
  return words;
}

function bodyHasBannedWord_(body) {
  const tokens = bannedWords_();
  if (!tokens.length) return false;
  const haystack = rot10_(String(body || '').toLowerCase());
  return tokens.some(function (token) {
    return !!token && haystack.indexOf(token) !== -1;
  });
}

function rot10_(text) {
  return rotShift_(text, 10);
}

function rot13_(text) {
  return rotShift_(text, 13);
}

function rotShift_(text, shift) {
  return String(text == null ? '' : text).replace(/[A-Za-z]/g, function (ch) {
    const base = ch <= 'Z' ? 65 : 97;
    const code = ch.charCodeAt(0);
    return String.fromCharCode(((code - base + shift) % 26 + 26) % 26 + base);
  });
}

function isoDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? String(value || '') : date.toISOString();
}

function dateNumber_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.getTime();
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? 0 : date.getTime();
}

function respond_(payload, callback) {
  const json = JSON.stringify(payload);
  const validCallback = callback && /^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback);
  if (validCallback) {
    return ContentService.createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function safeError_(error) {
  return error && error.message ? error.message : 'Request failed.';
}


