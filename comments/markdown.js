
window.IcelyMarkdown = (function () {
  'use strict';

  

          

    function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  function round3(value) {
    var rounded = parseFloat(value.toFixed(3));
    return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
  }

  function withGlobal(pattern) {
    return pattern.flags.indexOf('g') >= 0
      ? pattern
      : new RegExp(pattern.source, pattern.flags + 'g');
  }

  function balancedBracketReplace(text, pattern, replaceFunc) {
    var re = withGlobal(pattern);
    var result = [];
    var lastEnd = 0;
    var match;
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      if (match.index < lastEnd) continue;
      result.push(text.slice(lastEnd, match.index));
      var pos = re.lastIndex;
      var depth = 1;
      while (pos < text.length && depth > 0) {
        if (text.charAt(pos) === '[') depth += 1;
        else if (text.charAt(pos) === ']') depth -= 1;
        pos += 1;
      }
      if (depth === 0) {
        result.push(replaceFunc(text.slice(re.lastIndex, pos - 1)));
        lastEnd = pos;
      } else {
        result.push(text.slice(match.index, pos));
        lastEnd = pos;
      }
    }
    result.push(text.slice(lastEnd));
    return result.join('');
  }

  function balancedDelimiterEnd(text, openingIndex, opening, closing) {
    opening = opening || '[';
    closing = closing || ']';
    var depth = 0;
    var escaped = false;
    for (var pos = openingIndex; pos < text.length; pos += 1) {
      var char = text.charAt(pos);
      if (escaped) { escaped = false; continue; }
      if (char === '\\') escaped = true;
      else if (char === opening) depth += 1;
      else if (char === closing) {
        depth -= 1;
        if (depth === 0) return pos + 1;
      }
    }
    return null;
  }

  function makeCensorBar(content) {
    var bar = '';
    for (var i = 0; i < content.length; i += 1) {
      bar += content.charAt(i) === ' ' ? ' ' : '█';
    }
    if (bar.length < 3) bar = '███';
    return bar;
  }

  function processCensor(text) {
    text = balancedBracketReplace(text, /megacensor\[/g, function (content) {
      return '<span class="megacensor" title="">' + makeCensorBar(content) + '</span>';
    });
    text = balancedBracketReplace(text, /(?<!mega)censor\[/g, function (content) {
      return '<span class="censor" title="">' + makeCensorBar(content) + '</span>';
    });
    return text;
  }

  function processDoubleBracketCensor(text) {
    return text.replace(/(?<!\[)\[\[(?!\[)([^\]]*)\]\](?!\])/g, function (whole, content) {
      var bar = new Array(Math.max(content.length, 3) + 1).join('█');
      return '<span class="censor" title="">' + bar + '</span>';
    });
  }

  function spoilerSpan(content) {
    return '<span class="spoiler" role="button" tabindex="0" aria-expanded="false">' + content + '</span>';
  }

  function processSpoiler(text) {
    return balancedBracketReplace(text, /spoiler\[/g, spoilerSpan);
  }

  function processDiscordSpoiler(text) {
    return text.replace(/\|\|([^\n]+?)\|\|/g, function (whole, content) {
      return spoilerSpan(content);
    });
  }

  var COLOR_TAGS = [
    ['cyan',   'b',    'cyand'],
    ['brown',  'span', 'brown-text'],
    ['red',    'span', 'red-text'],
    ['yellow', 'span', 'yellow-text'],
    ['green',  'span', 'green-text'],
    ['purple', 'span', 'purple-text'],
    ['orange', 'span', 'orange-text'],
    ['pink',   'span', 'pink-text']
  ];

  function processColorTags(text) {
    COLOR_TAGS.forEach(function (entry) {
      var name = entry[0], tag = entry[1], cls = entry[2];
      text = balancedBracketReplace(text, new RegExp(name + '\\[', 'g'), function (content) {
        return '<' + tag + ' class="' + cls + '">' + content + '</' + tag + '>';
      });
    });
    return text;
  }

  var TOOLTIP_PREFIX_RE = /^Tooltip\/?(?:footnote)?:\s*/i;

  function makeTooltip(display, tipContent) {
    return '<span class="tooltip-wrap">' + display +
      '<span class="tooltip-box">' + formatTooltipContent(tipContent) + '</span></span>';
  }

  function replaceTripleTooltips(text) {
    var result = [];
    var lastEnd = 0;
    var marker = /\[\[\[/g;
    var match;
    while ((match = marker.exec(text)) !== null) {
      if (match.index < lastEnd) continue;
      var displayEnd = text.indexOf(']]]', marker.lastIndex);
      if (displayEnd < 0) continue;
      var parenStart = displayEnd + 3;
      if (parenStart >= text.length || text.charAt(parenStart) !== '(') continue;
      var parenEnd = balancedDelimiterEnd(text, parenStart, '(', ')');
      if (parenEnd === null) continue;

      result.push(text.slice(lastEnd, match.index));
      result.push(makeTooltip(
        text.slice(marker.lastIndex, displayEnd),
        text.slice(parenStart + 1, parenEnd - 1)
      ));
      lastEnd = parenEnd;
    }
    result.push(text.slice(lastEnd));
    return result.join('');
  }

  function replaceCensorTooltips(text) {
    var marker = /(?<!\w)(?:megacensor|censor)\[/g;
    var result = [];
    var lastEnd = 0;
    var match;
    while ((match = marker.exec(text)) !== null) {
      if (match.index < lastEnd) continue;
      var displayEnd = balancedDelimiterEnd(text, marker.lastIndex - 1, '[', ']');
      if (displayEnd === null) continue;
      if (displayEnd >= text.length || text.charAt(displayEnd) !== '(') continue;
      var parenEnd = balancedDelimiterEnd(text, displayEnd, '(', ')');
      if (parenEnd === null) continue;

      var tipContent = text.slice(displayEnd + 1, parenEnd - 1);
      if (!TOOLTIP_PREFIX_RE.test(tipContent)) continue;

      result.push(text.slice(lastEnd, match.index));
      result.push(makeTooltip(text.slice(match.index, displayEnd), tipContent));
      lastEnd = parenEnd;
    }
    result.push(text.slice(lastEnd));
    return result.join('');
  }

  function formatTooltipContent(tipContent) {
    tipContent = tipContent.replace(TOOLTIP_PREFIX_RE, '');

    tipContent = escapeHtml(tipContent);
    tipContent = processTooltips(tipContent);

    var generatedTags = [];
    tipContent = tipContent.replace(/<\/?[A-Za-z][^>]*>/g, function (tag) {
      generatedTags.push(tag);
      return '@@ICELY_TOOLTIP_TAG' + (generatedTags.length - 1) + '@@';
    });
    tipContent = processInline(tipContent);
    generatedTags.forEach(function (tag, index) {
      tipContent = tipContent.split('@@ICELY_TOOLTIP_TAG' + index + '@@').join(tag);
    });

    tipContent = processCensor(tipContent);
    tipContent = processSpoiler(tipContent);
    tipContent = processDiscordSpoiler(tipContent);
    tipContent = processColorTags(tipContent);
    tipContent = processDoubleBracketCensor(tipContent);
    tipContent = processInsertImages(tipContent);
    tipContent = processYoutubeTags(tipContent);
    tipContent = processEmoji(tipContent);
    tipContent = processTextEffects(tipContent);
    return tipContent;
  }

  function processTooltips(text) {
    return replaceCensorTooltips(replaceTripleTooltips(text));
  }

  function processInsertImages(text) {
    return text.replace(/\[insert\s+([^\]]+)\]/gi, function (whole, filename) {
      return '<img src="images/' + filename.trim() + '">';
    });
  }

  var YT_PATTERNS = [
    /^https?:\/\/youtu\.be\/([A-Za-z0-9_-]+)/,
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]+)/,
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/embed\/([A-Za-z0-9_-]+)/,
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]+)/,
    /^https?:\/\/(?:www\.|m\.)?youtube\.com\/v\/([A-Za-z0-9_-]+)/
  ];

  function processYoutubeTags(text) {
    return text.replace(/youtube\[([^\]]+)\]/g, function (whole, rawUrl) {
      var url = rawUrl.trim();
      for (var i = 0; i < YT_PATTERNS.length; i += 1) {
        var m = YT_PATTERNS[i].exec(url);
        if (m) {
          return '<iframe width="560" height="315" ' +
            'src="https:            'frameborder="0" allow="accelerometer; clipboard-write; ' +
            'encrypted-media; gyroscope; picture-in-picture; web-share" ' +
            'allowfullscreen></iframe>';
        }
      }
      return whole;
    });
  }

  function processEmoji(text) {
    return text
      .split(':frog:').join('<img width="20" src="images/frog.png" style="transform: translateY(5px);">')
      .split(':skull:').join('<img width="20" src="images/skull.png" style="transform: translateY(5px);">');
  }

  

      function perCharacterEffect(content, wrapClass, charClass, cycleSeconds, negativeDelay) {
    var nonSpace = 0;
    var i;
    for (i = 0; i < content.length; i += 1) {
      if (content.charAt(i) !== ' ') nonSpace += 1;
    }
    var total = Math.max(nonSpace, 1);
    var charsHtml = [];
    var idx = 0;
    for (i = 0; i < content.length; i += 1) {
      var char = content.charAt(i);
      if (char === ' ') {
        charsHtml.push(' ');
        continue;
      }
      var delay;
      var delayStr;
      if (negativeDelay) {
        delay = round3(idx * (cycleSeconds / total));
        delayStr = parseFloat(delay) > 0 ? '-' + delay + 's' : '0s';
      } else {
        delay = round3(i * cycleSeconds);
        delayStr = delay + 's';
      }
      charsHtml.push('<span class="' + charClass + '" style="animation-delay:' + delayStr + '">' +
        escapeHtml(char) + '</span>');
      idx += 1;
    }
    return '<span class="' + wrapClass + '">' + charsHtml.join('') + '</span>';
  }

  function processTextEffects(text) {
    text = balancedBracketReplace(text, /jitter\[/g, function (content) {
            return perCharacterEffect(content, 'jitter-wrap', 'jitter-char', 0.04, false);
    });
    text = balancedBracketReplace(text, /circlespin\[/g, function (content) {
      return perCharacterEffect(content, 'circlespin-wrap', 'circlespin-char', 1.5, true);
    });
    text = balancedBracketReplace(text, /glitch\[/g, function (content) {
      return perCharacterEffect(content, 'glitch-wrap', 'glitch-char', 1.8, true);
    });
    text = balancedBracketReplace(text, /wave\[/g, function (content) {
      return perCharacterEffect(content, 'wave-wrap', 'wave-char', 0.8, true);
    });
    return text;
  }

  

  function processSlideshows(text) {
    var hasSlideshow = false;

    var output = text.replace(/\[slide\]([\s\S]*?)\[\/slide\]/gi, function (whole, rawInner) {
      var inner = rawInner.trim();
      if (!inner) return '';

      hasSlideshow = true;

      var imagePattern = /!\[([^\]]*)\]\(([^)]+)\)|(<img\s+[^>]*>)/gi;
      var matches = [];
      var m;
      while ((m = imagePattern.exec(inner)) !== null) {
        matches.push({ match: m, start: m.index, end: imagePattern.lastIndex });
      }

      var slidesData = matches.map(function (entry, i) {
        var src = '';
        var alt = '';
        if (entry.match[1] !== undefined) {                    alt = entry.match[1];
          src = entry.match[2];
        } else {                                                var imgTag = entry.match[3];
          var srcMatch = /src=["']([^"']*)["']/i.exec(imgTag);
          var altMatch = /alt=["']([^"']*)["']/i.exec(imgTag);
          src = srcMatch ? srcMatch[1] : '';
          alt = altMatch ? altMatch[1] : '';
        }
        var isSpoiler = alt.trim().toUpperCase().indexOf('SPOILER') === 0;
        var endIndex = i + 1 < matches.length ? matches[i + 1].start : inner.length;
        var description = processInline(inner.slice(entry.end, endIndex).trim());
        return { src: src, alt: alt, desc: description, isSpoiler: isSpoiler };
      });

      if (!slidesData.length) return '';

      var slidesHtml = '';
      slidesData.forEach(function (slide) {
        var spoilerClass = slide.isSpoiler ? ' is-spoiler' : '';
        var spoilerAttributes = slide.isSpoiler ? ' role="button" tabindex="0" aria-expanded="false"' : '';
        var spoilerOverlay = slide.isSpoiler
          ? '<div class="spoiler-overlay"><span>SPOILER<br><small>Click to reveal</small></span></div>'
          : '';
        var captionHtml = slide.desc ? '<div class="slide-caption">' + slide.desc + '</div>' : '';
        slidesHtml +=
          '<div class="slide' + spoilerClass + '">\n' +
          '  <div class="slide-media-wrapper"' + spoilerAttributes + '>\n' +
          '    <img src="' + slide.src + '" alt="' + escapeHtml(slide.alt) + '">\n' +
          '    ' + spoilerOverlay + '\n' +
          '  </div>\n' +
          '  ' + captionHtml + '\n' +
          '</div>\n';
      });

      return '<div class="slideshow">\n' +
        '  <div class="slideshow-inner">' + slidesHtml + '</div>\n' +
        '  <div class="slideshow-controls">\n' +
        '    <button class="slide-prev">&laquo; Prev</button>\n' +
        '    <span class="slide-counter">1 / ' + slidesData.length + '</span>\n' +
        '    <button class="slide-next">Next &raquo;</button>\n' +
        '  </div>\n' +
        '</div>';
    });

    return { text: output, hasSlideshow: hasSlideshow };
  }

  

  var HTML_BLOCK_TAGS = 'div|table|script|style|details|summary|iframe|section|article|nav|aside|header|footer|form|pre|figure|figcaption|video|audio|canvas|svg|h[1-6]';
  var HTML_BLOCK_OPEN_RE = new RegExp('<(?:' + HTML_BLOCK_TAGS + ')\\b', 'gi');
  var HTML_BLOCK_CLOSE_RE = new RegExp('</(?:' + HTML_BLOCK_TAGS + ')\\b', 'gi');

  function countMatches(line, pattern) {
    var re = withGlobal(pattern);
    re.lastIndex = 0;
    var count = 0;
    while (re.exec(line) !== null) count += 1;
    return count;
  }

  function isHtmlLine(line) {
    var stripped = line.trim();
    if (!stripped) return false;
    if (/^<(?!\/?(em|strong|code|a|b|i|u|s|del|ins|mark|sub|sup|span|img)\b)/.test(stripped)) return true;
    if (stripped.indexOf('<!--') === 0) return true;
    return false;
  }

  function isHtmlBlockStart(line) {
    return new RegExp('^<(' + HTML_BLOCK_TAGS + ')\\b', 'i').test(line.trim());
  }

  

  function processInline(text) {
        var codeSpans = [];
    text = text.replace(/`([^`]+)`/g, function (whole, code) {
      codeSpans.push(code);
      return '@@ICELY_CODE' + (codeSpans.length - 1) + '@@';
    });

    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (whole, rawAlt, src) {
      var alt = rawAlt;
      var caption = '';
      var isSpoiler = alt.trim().toUpperCase().indexOf('SPOILER') === 0;
      var spoilerClass = isSpoiler ? ' is-spoiler' : '';
      var spoilerAttributes = isSpoiler ? ' role="button" tabindex="0" aria-expanded="false"' : '';
      var spoilerOverlay = isSpoiler
        ? '<div class="spoiler-overlay"><span>SPOILER<br><small>Click to reveal</small></span></div>'
        : '';

      var separator = alt.indexOf(' | ');
      if (separator >= 0) {
        caption = alt.slice(separator + 3);
        alt = alt.slice(0, separator);
      }

      var captionHtml = caption ? '<div class="img-caption">' + caption + '</div>' : '';
      return '<div class="img-block-wrapper' + spoilerClass + '"' + spoilerAttributes + '>\n' +
        '  <img class="img-block" src="' + src + '" alt="' + escapeHtml(alt) + '">\n' +
        '  ' + spoilerOverlay + '\n' +
        '</div>\n' + captionHtml;
    });

    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (whole, linkText, rawUrl) {
      var url = rawUrl;
      var isLocalUrl = !(url.indexOf('http') === 0 || url.indexOf('www.') === 0);
      if (/\.\.md$/.test(url) && isLocalUrl) {
        url = url.slice(0, -4) + '.md';
      } else if (/\.md$/.test(url) && isLocalUrl) {
        url = url.replace(/\.md$/, '.html');
      }
      if (url.indexOf('http') === 0 || url.indexOf('www.') === 0) {
        if (url.indexOf('www.') === 0) url = 'https://' + url;
        return '<a href="' + url + '" target="_blank">' + linkText + '</a>';
      }
      return '<a href="' + url + '">' + linkText + '</a>';
    });

    text = text.replace(/(?<!href=")(?<!src=")(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank">$1</a>');

    text = text.replace(/\*\*\*([^\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    text = text.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*(?!\*)([^\n]+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/~~([^\n]+?)~~/g, '<del>$1</del>');
    text = text.replace(/__([^\n]+?)__/g, '<u>$1</u>');

    codeSpans.forEach(function (code, idx) {
      text = text.split('@@ICELY_CODE' + idx + '@@').join('<code>' + escapeHtml(code) + '</code>');
    });

    return processParens(text);
  }

  function processParens(text) {
    var codeSpans = [];
    text = text.replace(/`([^`]+)`/g, function (whole, code) {
      codeSpans.push(code);
      return '@@ICELY_CODE' + (codeSpans.length - 1) + '@@';
    });

        var tags = [];
    text = text.replace(/<[^>]*(?:"[^"]*"[^>]*|'[^']*'[^>]*)*>/g, function (tag) {
      tags.push(tag);
      return '@@ICELY_TAG' + (tags.length - 1) + '@@';
    });

    text = text.replace(/\([^()]*\)/g, '<span class="paren">$&</span>');

    tags.forEach(function (tag, i) {
      text = text.split('@@ICELY_TAG' + i + '@@').join(tag);
    });
    codeSpans.forEach(function (code, idx) {
      text = text.split('@@ICELY_CODE' + idx + '@@').join('<code>' + escapeHtml(code) + '</code>');
    });

    return text;
  }

  function processCustomExtensions(text) {
    text = processTooltips(text);
    text = processCensor(text);
    text = processSpoiler(text);
    text = processDiscordSpoiler(text);
    text = processColorTags(text);
    text = processDoubleBracketCensor(text);
    text = processInsertImages(text);
    text = processYoutubeTags(text);
    text = processEmoji(text);
    text = processTextEffects(text);
    return text;
  }

  function fixUnclosedHtmlComments(text) {
    var depth = 0;
    var i = 0;
    while (i < text.length) {
      if (text.substr(i, 4) === '<!--') { depth += 1; i += 4; }
      else if (text.substr(i, 3) === '-->' && depth > 0) { depth -= 1; i += 3; }
      else i += 1;
    }
    while (depth > 0) { text += '-->'; depth -= 1; }
    return text;
  }

  var HR_RE = /^(---+|\*\*\*+|___+)\s*$/;
  var OL_RE = /^\d+\.\s+/;
  var STANDALONE_IMG_RE = /^(!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>)$/;

  function convertMarkdownBody(body) {
    var hasSlideshow = false;

    body = fixUnclosedHtmlComments(String(body == null ? '' : body).replace(/\r\n/g, '\n').replace(/\r/g, '\n'));

    var slideshowPass = processSlideshows(body);
    body = slideshowPass.text;
    hasSlideshow = slideshowPass.hasSlideshow;

    body = processCustomExtensions(body);

    var lines = body.split('\n');
    var result = [];
    var i = 0;
    var inList = false;
    var listType = null;
    var inHtmlBlock = false;
    var htmlBlockDepth = 0;
    var inDetails = false;

    function closeList() {
      if (inList) {
        result.push('</' + listType + '>');
        inList = false;
      }
    }

    while (i < lines.length) {
      var line = lines[i];
      var stripped = line.trim();

      if (inHtmlBlock) {
        result.push(line);
        htmlBlockDepth += countMatches(line, HTML_BLOCK_OPEN_RE) - countMatches(line, HTML_BLOCK_CLOSE_RE);
        if (htmlBlockDepth <= 0) { inHtmlBlock = false; htmlBlockDepth = 0; }
        i += 1;
        continue;
      }

      if (isHtmlBlockStart(stripped)) {
        closeList();
        inHtmlBlock = true;
        htmlBlockDepth = 1 - countMatches(line, HTML_BLOCK_CLOSE_RE);
        result.push(line);
        if (htmlBlockDepth <= 0) { inHtmlBlock = false; htmlBlockDepth = 0; }
        i += 1;
        continue;
      }

      if (isHtmlLine(line)) {
        closeList();
        result.push(line);
        i += 1;
        continue;
      }

      var headerMatch = /^(#{1,6})\s+(.+)$/.exec(stripped);
      if (headerMatch) {
        closeList();
        var level = headerMatch[1].length;
        var rawContent = headerMatch[2];
        var isCollapsible = rawContent.indexOf('(Collapsible) ') === 0;
        if (isCollapsible) rawContent = rawContent.slice('(Collapsible) '.length);
        var content = processInline(rawContent);
        if (isCollapsible) {
          if (inDetails) result.push('</details>');
          result.push('<details><summary><h' + level + '>' + content + '</h' + level + '></summary>');
          inDetails = true;
        } else {
          if (inDetails) { result.push('</details>'); inDetails = false; }
          result.push('<h' + level + '>' + content + '</h' + level + '>');
        }
        i += 1;
        continue;
      }

      if (stripped.indexOf('>') === 0) {
        closeList();
        var bqLines = [];
        while (i < lines.length && lines[i].trim().indexOf('>') === 0) {
          bqLines.push(lines[i].trim().slice(1));
          i += 1;
        }
        var groups = [];
        var cur = [];
        bqLines.forEach(function (bqLine) {
          if (!bqLine.trim()) {
            if (cur.length) { groups.push(cur); cur = []; }
          } else {
            cur.push(bqLine.trim());
          }
        });
        if (cur.length) groups.push(cur);

        var bqContent = '';
        if (groups.length) {
          var parts = groups.map(function (group) {
            var groupText = processCustomExtensions(group.join('<br>'));
            var groupPass = processSlideshows(groupText);
            if (groupPass.hasSlideshow) hasSlideshow = true;
            return processInline(groupPass.text);
          });
          bqContent = parts.length > 1 ? '<p>' + parts.join('</p><p>') + '</p>' : parts[0];
        }
        result.push('<blockquote>' + bqContent + '</blockquote>');
        continue;
      }

      if (stripped.indexOf('```') === 0) {
        closeList();
        var codeLines = [];
        i += 1;
        while (i < lines.length && lines[i].trim().indexOf('```') !== 0) {
          codeLines.push(lines[i]);
          i += 1;
        }
        i += 1;
        result.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
        continue;
      }

      if (HR_RE.test(stripped)) {
        closeList();
        result.push('<hr>');
        i += 1;
        continue;
      }

      if (STANDALONE_IMG_RE.test(stripped)) {
        closeList();
        result.push(processInline(stripped));
        if (i + 1 < lines.length) {
          var nextLine = lines[i + 1].trim();
          var nextStartsBlock = !nextLine ||
            /^#{1,6}\s/.test(nextLine) ||
            HR_RE.test(nextLine) ||
            nextLine.indexOf('* ') === 0 ||
            nextLine.indexOf('- ') === 0 ||
            OL_RE.test(nextLine) ||
            nextLine.indexOf('>') === 0 ||
            nextLine.indexOf('```') === 0 ||
            isHtmlBlockStart(nextLine) ||
            isHtmlLine(nextLine) ||
            STANDALONE_IMG_RE.test(nextLine);
          if (!nextStartsBlock) {
            result.push('<div class="img-caption">' + processInline(nextLine) + '</div>');
            i += 1;
          }
        }
        i += 1;
        continue;
      }

      var isUl = stripped.indexOf('* ') === 0 || stripped.indexOf('- ') === 0;
      var olMatch = OL_RE.exec(stripped);
      if (isUl || olMatch) {
        var currentType = isUl ? 'ul' : 'ol';
        var prefixLen = isUl ? 2 : olMatch[0].length;

        if (!inList) {
          result.push('<' + currentType + '>');
          inList = true;
          listType = currentType;
        } else if (listType !== currentType) {
          result.push('</' + listType + '>');
          result.push('<' + currentType + '>');
          listType = currentType;
        }

        result.push('<li>' + processInline(stripped.slice(prefixLen)) + '</li>');
        i += 1;
        continue;
      }

      if (!stripped) {
        closeList();
        result.push('');
        i += 1;
        continue;
      }

      closeList();

      var paraLines = [];
      while (i < lines.length) {
        var candidate = lines[i].trim();
        if (!candidate) break;
        if (/^#{1,6}\s+/.test(candidate)) break;
        if (HR_RE.test(candidate)) break;
        if (candidate.indexOf('* ') === 0 || candidate.indexOf('- ') === 0) break;
        if (OL_RE.test(candidate)) break;
        if (candidate.indexOf('```') === 0) break;
        if (candidate.indexOf('>') === 0) break;
        if (isHtmlBlockStart(lines[i]) || isHtmlLine(lines[i])) break;
        paraLines.push(candidate);
        i += 1;
      }

      if (paraLines.length) {
        result.push('<p>' + processInline(paraLines.join(' ')) + '</p>');
        continue;
      }

      i += 1;
    }

    closeList();
    if (inDetails) result.push('</details>');

    return { html: result.join('\n'), hasSlideshow: hasSlideshow };
  }

  return {
    convertMarkdownBody: convertMarkdownBody,
    processInline: processInline,
    processCustomExtensions: processCustomExtensions,
    escapeHtml: escapeHtml
  };
})();
