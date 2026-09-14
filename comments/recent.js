(function () {
  var endpoint = 'https://script.google.com/macros/s/AKfycbzskup_saxsuY3WkeWEBl_sK26ZDSDhM-jSe7GaZdHU1iXSV6GYpZr13tId-u1AX8ut/exec';
  var articleBase = 'https://icely.neocities.org/articles/';
  var status = document.querySelector('.recent-status');
  var list = document.querySelector('.recent-list');

  function articleUrl(comment) {
    return articleBase + encodeURIComponent(String(comment.articleSlug || '')) + '.html#comment-' + encodeURIComponent(String(comment.id || ''));
  }

  function formatDate(value) {
    var date = new Date(value);
    return isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  function render(comments) {
    status.textContent = comments.length ? '' : 'No approved comments yet.';
    comments.forEach(function (comment) {
      var item = document.createElement('article');
      item.className = 'recent-comment';
      var meta = document.createElement('div');
      meta.className = 'recent-meta';
      var link = document.createElement('a');
      link.href = articleUrl(comment);
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = String(comment.articleSlug || '').replace(/-/g, ' ');
      var author = document.createElement('span');
      author.className = 'recent-author';
      author.textContent = String(comment.username || 'Anonymous');
      var date = document.createElement('span');
      date.textContent = ' - ' + formatDate(comment.createdAt);
      var body = document.createElement('div');
      body.className = 'recent-body';
      body.textContent = String(comment.body || '');
      meta.appendChild(link);
      meta.appendChild(author);
      meta.appendChild(date);
      item.appendChild(meta);
      item.appendChild(body);
      list.appendChild(item);
    });
  }

  function reportHeight() {
    if (window.parent === window) return;
    // The wrapper grows the iframe to this height, so page scroll replaces inner scroll.
    document.documentElement.style.overflow = 'hidden';
    try { window.parent.postMessage({ type: 'icely-recent-height', height: document.documentElement.scrollHeight }, '*'); } catch (error) {}
  }
  if (window.ResizeObserver) new ResizeObserver(reportHeight).observe(document.body);
  window.addEventListener('load', reportHeight);
  reportHeight();

  var callbackName = '__icelyRecentComments_' + Date.now().toString(36);
  var script = document.createElement('script');
  window[callbackName] = function (payload) {
    try {
      if (!payload || payload.ok === false) throw new Error((payload && payload.error) || 'Comments could not be loaded.');
      render(Array.isArray(payload.comments) ? payload.comments : []);
    } catch (error) {
      status.textContent = error.message || 'Comments could not be loaded.';
      status.className = 'recent-status error';
    } finally {
      try { delete window[callbackName]; } catch (error) { window[callbackName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }
  };
  script.onerror = function () {
    status.textContent = 'Comments could not be loaded right now.';
    status.className = 'recent-status error';
  };
  script.src = endpoint + '?action=recent&limit=100&callback=' + encodeURIComponent(callbackName);
  document.head.appendChild(script);
})();
