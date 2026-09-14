(function () {
  var endpoint = 'https://script.google.com/macros/s/AKfycbzskup_saxsuY3WkeWEBl_sK26ZDSDhM-jSe7GaZdHU1iXSV6GYpZr13tId-u1AX8ut/exec';
  var PARENT_ORIGIN = 'https://icely.neocities.org';
   var articleSlug = readSlugFromPath();   var frame = document.querySelector('.comments-frame');   var list = document.querySelector('.comments-list');   var status = document.querySelector('.comments-status');   var form = document.querySelector('.comments-form');   var usernameInput = document.querySelector('[name="username"]');   var bodyInput = document.querySelector('[name="body"]');   var parentInput = document.querySelector('[name="parentId"]');   var honeypotInput = document.querySelector('[name="website"]');   var submitButton = document.querySelector('.comments-submit');   var formHint = document.querySelector('.comments-form-hint');   var defaultBodyPlaceholder = bodyInput.getAttribute('placeholder') || '';   var pseudoCommentsStorageKey = 'icely-comments-pseudocomments:' + articleSlug;   var draftStorageKey = 'icely-comments-draft:' + articleSlug;   var editDraftStorageKey = 'icely-comments-edit-drafts:' + articleSlug;   var deletedCommentsStorageKey = 'icely-comments-deleted:' + articleSlug;   var pseudoCommentDelay = 700;   var draftSaveDelay = 3000;   var pendingDraftTimer = null;   var pendingDraftInfo = null;   var comments = [];   var appendixHtml = '';   var appendixMarkdown = '';   var appendixRenderedFrom = null;   var pseudoComments = [];   var commentEdits = {};   var deletedComments = {};   var activeEdit = null;
  var loaded = false;
  var loading = false;
  var activeTargetId = null;
  var parentHref = '';

  function readSlugFromPath() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    var index = parts.indexOf('comments');
    var raw = index >= 0 ? (parts[index + 1] || '') : (parts[parts.length - 1] || '');
    if (raw === 'index.html' || raw === '404.html') raw = '';
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }

  // The parent sizes the iframe from whatever we report here. That makes this a
  // feedback loop: a new height can add or remove a scrollbar, which changes the
  // content width, which rewraps text and changes the height again. The gutter is
  // reserved in CSS so width no longer moves, and the threshold below absorbs any
  // remaining sub-pixel churn so we never bounce the parent over 1-2px.
  var lastReportedHeight = -1;
  var HEIGHT_EPSILON = 4;
  function reportHeight() {
    if (window.parent === window) return;
    var height = Math.ceil(status.offsetHeight + list.scrollHeight + form.offsetHeight);
    if (lastReportedHeight >= 0 && Math.abs(height - lastReportedHeight) < HEIGHT_EPSILON) return;
    lastReportedHeight = height;
    window.parent.postMessage({ type: 'icely-comments-height', height: height }, PARENT_ORIGIN);
  }

  var heightTimer = null;
  function queueHeight() {
    if (heightTimer) return;
    heightTimer = window.setTimeout(function () {
      heightTimer = null;
      // Measure after layout has settled rather than mid-reflow.
      if (window.requestAnimationFrame) window.requestAnimationFrame(reportHeight);
      else reportHeight();
    }, 100);
  }

  function setStatus(message, kind) {
    status.textContent = '';
    if (kind === 'loading') {
      var loadingImage = document.createElement('img');
      loadingImage.src = '/toading.png';
      loadingImage.alt = 'Comments loading...';
      loadingImage.addEventListener('load', queueHeight);
      status.appendChild(loadingImage);
    } else {
      status.textContent = message || '';
    }
    status.className = 'comments-status' + (kind ? ' ' + kind : '');
    status.onclick = null;
    status.onkeydown = null;
    status.style.cursor = '';
    status.removeAttribute('role');
    status.removeAttribute('tabindex');
    status.removeAttribute('aria-label');
    queueHeight();
  }

  function setFormHint(message, kind) {
    formHint.textContent = message || '';
    formHint.className = 'comments-form-hint' + (kind ? ' ' + kind : '');
    queueHeight();
  }

  function storageGet(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function readCommentEdits() {
    var stored = storageGet(editDraftStorageKey);
    if (!stored) return {};
    try {
      var values = JSON.parse(stored);
      if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
      var result = {};
      Object.keys(values).forEach(function (id) {
        var value = values[id];
        if (!value || typeof value !== 'object') return;
        var body = String(value.body || '');
        if (!body.trim()) return;
        result[String(id)] = {
          body: body,
          parentId: String(value.parentId || ''),
          pending: value.pending !== false
        };
      });
      return result;
    } catch (e) {
      return {};
    }
  }

  function writeCommentEdits() {
    if (!Object.keys(commentEdits).length) {
      storageRemove(editDraftStorageKey);
      return;
    }
    storageSet(editDraftStorageKey, JSON.stringify(commentEdits));
  }

  function saveCommentEditDraft(comment, body) {
    var id = String(comment.id || '');
    if (!id || !body.trim()) return;
    commentEdits[id] = {
      body: body,
      parentId: String(comment.parentId || ''),
      pending: true
    };
    writeCommentEdits();
  }

  function removeCommentEditDraft(commentId) {
    delete commentEdits[String(commentId || '')];
    writeCommentEdits();
  }

  function readDeletedComments() {
    var stored = storageGet(deletedCommentsStorageKey);
    if (!stored) return {};
    try {
      var values = JSON.parse(stored);
      if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
      var result = {};
      Object.keys(values).forEach(function (id) {
        if (values[id]) result[String(id)] = true;
      });
      return result;
    } catch (e) {
      return {};
    }
  }

  function writeDeletedComments() {
    if (!Object.keys(deletedComments).length) {
      storageRemove(deletedCommentsStorageKey);
      return;
    }
    storageSet(deletedCommentsStorageKey, JSON.stringify(deletedComments));
  }

  function markCommentDeleted(commentId) {
    var id = String(commentId || '');
    if (!id) return;
    deletedComments[id] = true;
    writeDeletedComments();
  }

  function reconcileDeletedComments(serverComments) {
    var serverIds = {};
    var changed = false;
    serverComments.forEach(function (comment) {
      serverIds[String(comment.id || '')] = true;
    });
    Object.keys(deletedComments).forEach(function (id) {
      if (!serverIds[id]) {
        delete deletedComments[id];
        changed = true;
      }
    });
    if (changed) writeDeletedComments();
  }

  function setCommentBody(element, text) {
    element.textContent = '';
    var source = String(text == null ? '' : text);
    var re = /\|\|([^|\r\n]+?)\|\|/g;
    var lastIndex = 0;
    var match;
    while ((match = re.exec(source)) !== null) {
      if (match.index > lastIndex) {
        element.appendChild(document.createTextNode(source.slice(lastIndex, match.index)));
      }
      var span = document.createElement('span');
      span.className = 'spoiler';
      span.setAttribute('role', 'button');
      span.setAttribute('tabindex', '0');
      span.setAttribute('aria-expanded', 'false');
      span.textContent = match[1];
      element.appendChild(span);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < source.length) {
      element.appendChild(document.createTextNode(source.slice(lastIndex)));
    }
  }

  function displayedCommentBody(comment) {
    var edit = commentEdits[String(comment.id || '')];
    return edit ? edit.body : String(comment.body || '');
  }

  function reconcileCommentEdits(serverComments) {
    var changed = false;
    serverComments.forEach(function (comment) {
      var id = String(comment.id || '');
      var localEdit = commentEdits[id];
      var isPendingComment = String(comment.kind || '').toUpperCase() === 'PENDING';
      if (!localEdit || (!comment.edited && !isPendingComment)) return;
      if (String(comment.body || '') === String(localEdit.body || '')) {
        delete commentEdits[id];
        changed = true;
      }
    });
    if (changed) writeCommentEdits();
  }

  function readDraft() {
    var stored = storageGet(draftStorageKey);
    if (!stored) return { body: '', parentId: '' };
    try {
      var draft = JSON.parse(stored);
      if (!draft || typeof draft !== 'object') return { body: '', parentId: '' };
      return {
        body: String(draft.body || ''),
        parentId: String(draft.parentId || '')
      };
    } catch (e) {
      return { body: '', parentId: '' };
    }
  }

  function saveDraft() {
    var body = bodyInput.value;
    var parentId = parentInput.value;
    if (!body && !parentId) {
      storageRemove(draftStorageKey);
      return;
    }
    storageSet(draftStorageKey, JSON.stringify({ body: body, parentId: parentId }));
  }

  function clearDraft() {
    storageRemove(draftStorageKey);
  }

  function queueServerDraft(editComment, editBody) {
    if (pendingDraftTimer) window.clearTimeout(pendingDraftTimer);
    pendingDraftInfo = editComment ? {
      commentId: String(editComment.id || ''),
      parentId: String(editComment.parentId || ''),
      body: String(editBody || '')
    } : null;
    pendingDraftTimer = window.setTimeout(sendServerDraft, draftSaveDelay);
  }

  function sendServerDraft(useBeacon) {
    pendingDraftTimer = null;
    if (!endpoint) return;
    var editInfo = pendingDraftInfo;
    pendingDraftInfo = null;
    var username = usernameInput.value;
    var body = editInfo ? editInfo.body : bodyInput.value;
    if (!String(username || '').trim() && !String(body || '').trim()) return;
    var payload = {
      action: 'draft',
      articleSlug: articleSlug,
      parentId: editInfo ? editInfo.parentId : parentInput.value,
      username: username,
      body: body,
      website: honeypotInput.value,
      clientId: getClientId(),
      commentId: editInfo ? editInfo.commentId : '',
      draftType: editInfo ? 'EDIT' : 'COMPOSE'
    };
    var serialized = JSON.stringify(payload);
    if (useBeacon && navigator.sendBeacon) {
      try {
        var queued = navigator.sendBeacon(endpoint, new Blob([serialized], { type: 'text/plain;charset=UTF-8' }));
        if (queued) return;
      } catch (e) {}
    }
    fetch(endpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      keepalive: !!useBeacon,
      body: serialized
    }).catch(function () {});
  }

  function flushServerDraft() {
    if (!pendingDraftTimer && !pendingDraftInfo) return;
    if (pendingDraftTimer) window.clearTimeout(pendingDraftTimer);
    sendServerDraft(true);
  }

  function commentIdentity(comment) {
    return JSON.stringify([
      String(comment.parentId || ''),
      String(comment.username || ''),
      String(comment.body || '')
    ]);
  }

  function normalisePseudoComment(value) {
    if (!value || typeof value !== 'object') return null;
    var id = String(value.id || '');
    var username = String(value.username || '').trim();
    var body = String(value.body || '');
    if (!id || !username || !body.trim()) return null;
    return {
      id: id,
      parentId: String(value.parentId || ''),
      username: username,
      body: body,
      kind: 'PENDING',
      createdAt: String(value.createdAt || ''),
      canEdit: true
    };
  }

  function readPseudoComments() {
    var stored = storageGet(pseudoCommentsStorageKey);
    if (!stored) return [];
    try {
      var values = JSON.parse(stored);
      if (!Array.isArray(values)) return [];
      var seen = {};
      return values.map(normalisePseudoComment).filter(function (comment) {
        if (!comment) return false;
        var identity = commentIdentity(comment);
        if (seen[identity]) return false;
        seen[identity] = true;
        return true;
      });
    } catch (e) {
      return [];
    }
  }

  function writePseudoComments() {
    storageSet(pseudoCommentsStorageKey, JSON.stringify(pseudoComments));
  }

  function mergePseudoComments(approvedComments) {
    var visibleComments = approvedComments.filter(function (comment) {
      return !deletedComments[String(comment.id || '')];
    });
    var approvedIds = {};
    var approvedIdentities = {};
    visibleComments.forEach(function (comment) {
      approvedIds[String(comment.id || '')] = true;
      approvedIdentities[commentIdentity(comment)] = true;
    });
    var seen = {};
    var retained = [];
    pseudoComments.forEach(function (comment) {
      var identity = commentIdentity(comment);
      if (deletedComments[String(comment.id || '')] || approvedIds[String(comment.id || '')] || approvedIdentities[identity] || seen[identity]) return;
      seen[identity] = true;
      retained.push(comment);
    });
    if (retained.length !== pseudoComments.length) {
      pseudoComments = retained;
      writePseudoComments();
    }
    return visibleComments.concat(retained);
  }

  function makePseudoCommentId() {
    return 'pending-' + getClientId() + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function addPseudoComment(username, body, parentId, commentId) {
    var candidate = {
      id: commentId || makePseudoCommentId(),
      parentId: parentId || '',
      username: username,
      body: body,
      kind: 'PENDING',
      createdAt: new Date().toISOString(),
      canEdit: true
    };
    var identity = commentIdentity(candidate);
    var approvedMatch = comments.filter(function (comment) {
      return String(comment.kind || '').toUpperCase() !== 'PENDING' && commentIdentity(comment) === identity;
    })[0];
    if (approvedMatch) {
      var pendingBefore = pseudoComments.length;
      pseudoComments = pseudoComments.filter(function (comment) {
        return commentIdentity(comment) !== identity;
      });
      if (pseudoComments.length !== pendingBefore) writePseudoComments();
      comments = comments.filter(function (comment) {
        return String(comment.kind || '').toUpperCase() !== 'PENDING' || commentIdentity(comment) !== identity;
      });
      renderComments();
      return;
    }
    var existing = pseudoComments.filter(function (comment) {
      return commentIdentity(comment) === identity;
    })[0];
    if (existing) {
      candidate = existing;
    } else {
      pseudoComments.push(candidate);
      writePseudoComments();
    }
    var alreadyVisible = comments.filter(function (comment) {
      return String(comment.id || '') === String(candidate.id || '') || commentIdentity(comment) === identity;
    }).length > 0;
    if (!alreadyVisible) comments.push(candidate);
    renderComments();
  }

  pseudoComments = readPseudoComments();
  commentEdits = readCommentEdits();
  deletedComments = readDeletedComments();

  function getClientId() {
    var key = 'icely-comments-client-id';
    var id = storageGet(key);
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      storageSet(key, id);
    }
    return id;
  }

  usernameInput.value = storageGet('icely-comments-username');
  var savedDraft = readDraft();
  bodyInput.value = savedDraft.body;
  parentInput.value = savedDraft.parentId;
  if (savedDraft.parentId) bodyInput.placeholder = 'Write a reply...';
  usernameInput.addEventListener('input', function () {
    storageSet('icely-comments-username', usernameInput.value);
    queueServerDraft();
  });
  bodyInput.addEventListener('input', saveDraft);
  bodyInput.addEventListener('input', queueServerDraft);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushServerDraft();
  });
  window.addEventListener('pagehide', flushServerDraft);

  function domId(commentId) {
    return 'comment-' + String(commentId || '').replace(/[^A-Za-z0-9_-]/g, '-');
  }

  function commentUrl(commentId) {
    var base = parentHref || document.referrer || window.location.href;
    return base.split('#')[0] + '#comment-' + encodeURIComponent(commentId);
  }

  function setCommentHash(commentId) {
    if (window.parent === window) return;
    window.parent.postMessage({ type: 'icely-comments-hash', id: String(commentId || '') }, PARENT_ORIGIN);
  }

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  function childrenFor(parentId) {
    return comments.filter(function (comment) {
      return String(comment.parentId || '') === String(parentId || '');
    });
  }

  function makeButton(label, className, handler) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className || '';
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function makeActionLink(label, className, handler) {
    var link = document.createElement('a');
    link.href = '#';
    link.className = className || '';
    link.textContent = label;
    link.addEventListener('click', function (event) {
      event.preventDefault();
      handler(event);
    });
    return link;
  }

  function sendCommentAction(action, comment, body) {
    if (!endpoint) return Promise.reject(new Error('Comments are not connected yet.'));
    var payload = {
      action: action,
      articleSlug: articleSlug,
      commentId: String(comment.id || ''),
      body: body || '',
      website: honeypotInput.value,
      clientId: getClientId()
    };
    return fetch(endpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
  }

  function editableComment(comment) {
    return comment.canEdit === true && !childrenFor(String(comment.id || '')).length;
  }

  function updatePendingCommentBody(commentId, body) {
    var changed = false;
    pseudoComments.forEach(function (comment) {
      if (String(comment.id || '') !== String(commentId || '')) return;
      comment.body = body;
      changed = true;
    });
    comments.forEach(function (comment) {
      if (String(comment.id || '') !== String(commentId || '')) return;
      comment.body = body;
      changed = true;
    });
    if (changed) writePseudoComments();
  }

  function hideCommentLocally(commentId) {
    var id = String(commentId || '');
    markCommentDeleted(id);
    pseudoComments = pseudoComments.filter(function (comment) {
      return String(comment.id || '') !== id;
    });
    writePseudoComments();
    comments = comments.filter(function (comment) {
      return String(comment.id || '') !== id;
    });
    removeCommentEditDraft(id);
    if (activeEdit && activeEdit.id === id) activeEdit = null;
    renderComments();
  }

  function editableText(element) {
    return String(element.innerText || element.textContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
  }

  function finishInlineEdit(comment, body, controls, restoreState) {
    body.contentEditable = 'false';
    body.classList.remove('comments-editing');
    if (restoreState) {
      if (restoreState.previousEdit) commentEdits[String(comment.id || '')] = restoreState.previousEdit;
      else delete commentEdits[String(comment.id || '')];
      writeCommentEdits();
    }
    activeEdit = null;
    renderComments();
  }

  function beginInlineEdit(comment, body, controls) {
    if (!editableComment(comment)) return;
    if (activeEdit && activeEdit.id !== String(comment.id || '')) {
      activeEdit = null;
      renderComments();
    }
    var id = String(comment.id || '');
    var previousEdit = commentEdits[id] ? {
      body: commentEdits[id].body,
      parentId: commentEdits[id].parentId,
      pending: commentEdits[id].pending
    } : null;
    activeEdit = { id: id, originalBody: displayedCommentBody(comment), previousEdit: previousEdit };
    body.contentEditable = 'true';
    body.classList.add('comments-editing');
    body.focus();
    var selection = window.getSelection();
    if (selection && document.createRange) {
      var range = document.createRange();
      range.selectNodeContents(body);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    body.addEventListener('input', function () {
      if (!activeEdit || activeEdit.id !== id) return;
      var draftBody = editableText(body);
      if (!draftBody) return;
      saveCommentEditDraft(comment, draftBody);
      queueServerDraft(comment, draftBody);
      queueHeight();
    });

    controls.textContent = '';
    controls.appendChild(makeActionLink('save', '', function () {
      var editedBody = editableText(body);
      if (!editedBody) {
        setStatus('Please write a comment.', 'error');
        body.focus();
        return;
      }
      if (editedBody.length > 10000) {
        setStatus('Comments must be 10000 characters or fewer.', 'error');
        body.focus();
        return;
      }
      saveCommentEditDraft(comment, editedBody);
      queueServerDraft(comment, editedBody);
      finishInlineEdit(comment, body, controls, null);
      setStatus('Saving edit...');
      sendCommentAction('edit', comment, editedBody).then(function () {
        updatePendingCommentBody(comment.id, editedBody);
        if (String(comment.kind || '').toUpperCase() === 'PENDING') {
          removeCommentEditDraft(comment.id);
        }
        setStatus('Edit sent.', 'success');
      }).catch(function () {
        setStatus('Edit is shown locally, but could not be sent.', 'error');
      });
    }));
    controls.appendChild(makeActionLink('cancel', '', function () {
      finishInlineEdit(comment, body, controls, { previousEdit: previousEdit });
    }));
  }

  function deleteComment(comment) {
    if (!editableComment(comment)) return;
    if (!window.confirm('Delete this comment?')) return;
    hideCommentLocally(comment.id);
    setStatus('Deleting...');
    sendCommentAction('delete', comment, '').then(function () {
      setStatus('Comment deleted.', 'success');
    }).catch(function () {
      setStatus('Comment is hidden locally, but could not be deleted.', 'error');
    });
  }

  function renderComment(comment, depth, seen) {
    var id = String(comment.id || '');
    if (!id || seen[id] || depth > 12) return null;
    seen[id] = true;
    var isPseudoComment = String(comment.kind || '').toUpperCase() === 'PENDING';

    var item = document.createElement('article');
    item.className = 'comments-item' + (String(comment.kind || '').toUpperCase() === 'AUTHOR' ? ' comments-author' : '');
    item.id = domId(id);
    item.tabIndex = -1;
    item.dataset.commentId = id;

    var meta = document.createElement('div');
    meta.className = 'comments-meta';
    var author = document.createElement('span');
    author.className = 'comments-author-name';
    author.textContent = comment.username || 'Anonymous';
    meta.appendChild(author);
    var date = document.createElement('time');
    date.textContent = formatDate(comment.createdAt);
    meta.appendChild(date);

    var body = document.createElement('div');
    body.className = 'comments-body';
    setCommentBody(body, displayedCommentBody(comment));

    var canEdit = editableComment(comment);
    var metaActions = document.createElement('div');
    metaActions.className = 'comments-meta-actions';
    var editControls = null;
    if (canEdit) {
      editControls = document.createElement('div');
      editControls.className = 'comments-controls comments-edit-controls';
      editControls.appendChild(makeActionLink('Edit', '', function () {
        beginInlineEdit(comment, body, editControls);
      }));
      editControls.appendChild(makeActionLink('Delete', '', function () {
        deleteComment(comment);
      }));
      metaActions.appendChild(editControls);
    }

    if (!isPseudoComment) {
      var controls = document.createElement('div');
      controls.className = 'comments-controls';
      controls.appendChild(makeActionLink('Reply', '', function () {
        parentInput.value = id;
        bodyInput.placeholder = 'Write a reply...';
        saveDraft();
        queueServerDraft();
        bodyInput.focus();
      }));
      controls.appendChild(makeActionLink('Copy link', '', function () {
        var url = commentUrl(id);
        setCommentHash(id);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () { setStatus('Comment link copied.', 'success'); }, function () { setStatus(url, 'success'); });
        } else {
          setStatus(url, 'success');
        }
      }));
      metaActions.appendChild(controls);
    }

    if (metaActions.childNodes.length) meta.appendChild(metaActions);
    item.appendChild(meta);
    item.appendChild(body);

    var childComments = childrenFor(id);
    if (childComments.length) {
      var children = document.createElement('div');
      children.className = 'comments-children';
      childComments.forEach(function (child) {
        var childElement = renderComment(child, depth + 1, seen);
        if (childElement) children.appendChild(childElement);
      });
      item.appendChild(children);
    }
    return item;
  }

  function focusTarget(commentId) {
    if (!commentId) return;
    var target = document.getElementById(domId(commentId));
    if (!target) {
      setStatus('That comment is not available. It may still be awaiting.', 'error');
      return;
    }
    target.scrollIntoView({ block: 'center' });
    target.classList.remove('comments-target');
    void target.offsetWidth;
    target.classList.add('comments-target');
    target.focus({ preventScroll: true });
  }

  function absolutizeAppendix(root) {
    var base = (parentHref || document.referrer || '').split('#')[0] ||
      'https://icely.neocities.org/articles/';
    function resolve(element, attribute) {
      var value = element.getAttribute(attribute);
      if (!value || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.indexOf('//') === 0 || value.charAt(0) === '#') return;
      try { element.setAttribute(attribute, new URL(value, base).href); } catch (e) {}
    }
    Array.prototype.forEach.call(root.querySelectorAll('[src]'), function (element) {
      resolve(element, 'src');
    });
    Array.prototype.forEach.call(root.querySelectorAll('a[href]'), function (link) {
      resolve(link, 'href');
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener');
    });
  }

  function bindAppendixInteractions(root) {
    var spoilerSelector = '.spoiler, .is-spoiler .slide-media-wrapper, .is-spoiler.img-block-wrapper';
    root.addEventListener('click', function (event) {
      var spoiler = event.target.closest(spoilerSelector);
      if (!spoiler || spoiler.classList.contains('revealed')) return;
      spoiler.classList.add('revealed');
      spoiler.setAttribute('aria-expanded', 'true');
      event.preventDefault();
      event.stopPropagation();
    }, true);
    root.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var spoiler = event.target.closest(spoilerSelector);
      if (!spoiler || spoiler.classList.contains('revealed')) return;
      event.preventDefault();
      spoiler.classList.add('revealed');
      spoiler.setAttribute('aria-expanded', 'true');
    });

    Array.prototype.forEach.call(root.querySelectorAll('.slideshow'), function (show) {
      var slides = show.querySelectorAll('.slide');
      if (!slides.length) return;
      var counter = show.querySelector('.slide-counter');
      var idx = 0;
      function update() {
        Array.prototype.forEach.call(slides, function (slide, i) {
          slide.classList.toggle('active', i === idx);
        });
        if (counter) counter.textContent = (idx + 1) + ' / ' + slides.length;
        queueHeight();
      }
      var prev = show.querySelector('.slide-prev');
      var next = show.querySelector('.slide-next');
      if (prev) prev.addEventListener('click', function () { idx = (idx - 1 + slides.length) % slides.length; update(); });
      if (next) next.addEventListener('click', function () { idx = (idx + 1) % slides.length; update(); });
      update();
    });

    Array.prototype.forEach.call(root.querySelectorAll('img'), function (image) {
      image.addEventListener('load', queueHeight);
    });
  }

  function buildAppendix() {
    var renderer = window.IcelyMarkdown;
    var html = '';
    if (appendixMarkdown && renderer) {
      try {
        html = renderer.convertMarkdownBody(appendixMarkdown).html;
      } catch (error) {
        html = '';
      }
    }
    if (!html) html = appendixHtml;
    if (!html) return null;

    var appendix = document.createElement('div');
    appendix.className = 'comments-appendix';
    appendix.innerHTML = html;
    absolutizeAppendix(appendix);
    bindAppendixInteractions(appendix);
    appendixRenderedFrom = parentHref;
    return appendix;
  }

  function revealSpoiler(target) {
    var spoiler = target && target.closest ? target.closest('.comments-body .spoiler') : null;
    if (!spoiler || spoiler.classList.contains('revealed')) return false;
    spoiler.classList.add('revealed');
    spoiler.setAttribute('aria-expanded', 'true');
    return true;
  }

  list.addEventListener('click', function (event) {
    if (revealSpoiler(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  list.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (revealSpoiler(event.target)) event.preventDefault();
  });

  function renderComments() {
    list.textContent = '';
    var appendixNode = buildAppendix();
    if (appendixNode) list.appendChild(appendixNode);
    if (!comments.length) {
      var empty = document.createElement('div');
      empty.className = 'comments-empty';
      empty.textContent = 'No comments yet.';
      list.appendChild(empty);
      queueHeight();
      return;
    }
    var commentIds = {};
    comments.forEach(function (comment) { commentIds[String(comment.id || '')] = true; });
    var roots = comments.filter(function (comment) {
      var parentId = String(comment.parentId || '');
      return !parentId || !commentIds[parentId];
    });
    var seen = {};
    roots.forEach(function (comment) {
      var element = renderComment(comment, 0, seen);
      if (element) list.appendChild(element);
    });
    comments.forEach(function (comment) {
      if (!seen[String(comment.id || '')]) {
        var element = renderComment(comment, 0, seen);
        if (element) list.appendChild(element);
      }
    });
    queueHeight();
    if (activeTargetId) {
      window.setTimeout(function () { focusTarget(activeTargetId); }, 0);
    }
  }

  function loadComments(targetId) {
    activeTargetId = targetId || activeTargetId || '';
    if (!endpoint) {
      setStatus('Comments are not connected yet.', 'error');
      return;
    }
    if (!articleSlug) {
      setStatus('Comments are not connected yet.', 'error');
      return;
    }
    if (loaded) {
      renderComments();
      if (activeTargetId) focusTarget(activeTargetId);
      return;
    }
    if (loading) return;
    loading = true;
    setStatus('Loading comments...', 'loading');
    var callbackName = '__icelyComments_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    var script = document.createElement('script');
    var params = '?action=list&article=' + encodeURIComponent(articleSlug) + '&clientId=' + encodeURIComponent(getClientId()) + '&callback=' + encodeURIComponent(callbackName);
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      loading = false;
      try { delete window[callbackName]; } catch (e) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    window[callbackName] = function (payload) {
      finish();
      if (!payload || payload.ok === false) {
        setStatus((payload && payload.error) || 'Comments could not be loaded.', 'error');
        return;
      }
      var serverComments = Array.isArray(payload.comments) ? payload.comments : [];
      reconcileDeletedComments(serverComments);
      reconcileCommentEdits(serverComments);
      comments = mergePseudoComments(serverComments);
      appendixMarkdown = String(payload.appendixMarkdown || '');
      appendixHtml = String(payload.appendixHtml || '');
      loaded = true;
      setStatus('');
      renderComments();
    };
    script.onerror = function () {
      finish();
      setStatus('Comments could not be loaded right now.', 'error');
    };
    script.src = endpoint + params;
    document.head.appendChild(script);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var username = usernameInput.value.trim();
    var body = bodyInput.value.trim();
    if (!endpoint) { setStatus('Comments are not connected yet.', 'error'); setFormHint('Unable to send right now. Check your connection.', 'error'); return; }
    if (!username) { setStatus('Please enter a username.', 'error'); usernameInput.focus(); return; }
    if (!body) { setStatus('Please write a comment.', 'error'); bodyInput.focus(); return; }
    if (username.length > 80) { setStatus('Usernames must be 80 characters or fewer.', 'error'); usernameInput.focus(); return; }
    if (body.length > 10000) { setStatus('Comments must be 10000 characters or fewer.', 'error'); bodyInput.focus(); return; }

    if (pendingDraftTimer) window.clearTimeout(pendingDraftTimer);
    pendingDraftTimer = null;
    pendingDraftInfo = null;
    submitButton.disabled = true;
    setStatus('Sending...');
    setFormHint('Sending...');
    var submissionId = makePseudoCommentId();
    var payload = {
      action: 'submit',
      articleSlug: articleSlug,
      commentId: submissionId,
      parentId: parentInput.value.trim(),
      username: username,
      body: body,
      website: honeypotInput.value,
      clientId: getClientId()
    };
    storageSet('icely-comments-username', username);
    saveDraft();
    fetch(endpoint, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    }).then(function () {
      bodyInput.value = '';
      parentInput.value = '';
      bodyInput.placeholder = defaultBodyPlaceholder;
      clearDraft();
      window.setTimeout(function () {
        addPseudoComment(payload.username, payload.body, payload.parentId, payload.commentId);
        setFormHint('');
        setStatus('Sent. (click to copy your recent comment if you still want to use it)', 'success');
        status.style.cursor = 'pointer';
        status.setAttribute('role', 'button');
        status.setAttribute('tabindex', '0');
        status.setAttribute('aria-label', 'Copy your recent comment');

        function copyRecentComment() {
          function fallbackCopy() {
            var textarea = document.createElement('textarea');
            textarea.value = payload.body;
            textarea.style.position = 'fixed';
            textarea.style.left = '-10000px';
            textarea.style.top = '0';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            var copied = false;
            try { copied = document.execCommand('copy'); } catch (error) {}
            document.body.removeChild(textarea);
            setStatus(copied ? 'Comment copied.' : 'Your browser prevented copying.', copied ? 'success' : 'error');
          }

          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(payload.body).then(function () {
              setStatus('Comment copied.', 'success');
            }).catch(fallbackCopy);
          } else {
            fallbackCopy();
          }
        }

        status.onclick = copyRecentComment;
        status.onkeydown = function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            copyRecentComment();
          }
        };
        submitButton.disabled = false;
      }, pseudoCommentDelay);
    }).catch(function () {
      setFormHint('Unable to send. Check your connection and try again.', 'error');
      setStatus('The comment could not be sent. Please try again.', 'error');
      submitButton.disabled = false;
    });
  });

  window.addEventListener('message', function (event) {
    if (event.origin !== PARENT_ORIGIN) return;
    var data = event.data;
    if (!data || data.type !== 'icely-comments-open') return;
    if (data.href) parentHref = String(data.href);
    if (loaded && !activeEdit && (appendixMarkdown || appendixHtml) &&
        appendixRenderedFrom !== parentHref) {
      renderComments();
    }
    var targetId = String(data.targetId || '');
    if (targetId) {
      activeTargetId = targetId;
      if (loaded) focusTarget(targetId);
    }
    reportHeight();
  });

  if (window.ResizeObserver) {
    var observer = new ResizeObserver(queueHeight);
    observer.observe(list);
    observer.observe(form);
    observer.observe(status);
  }
  window.addEventListener('load', reportHeight);

  loadComments();
})();
