const sanitizeHtml = require("sanitize-html");

const sanitizeContent = (dirtyHtml) => {
  if (!dirtyHtml) return dirtyHtml;
  
  return sanitizeHtml(dirtyHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'iframe', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div', 'u', 's', 'sup', 'sub'
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      '*': ['style', 'class', 'id'],
      'iframe': ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen', 'title'],
      'img': ['src', 'alt', 'width', 'height']
    },
    allowedIframeHostnames: ['www.youtube.com', 'player.vimeo.com', 'youtube.com', 'vimeo.com'],
    allowedSchemes: ['http', 'https', 'ftp', 'mailto', 'tel'],
    allowProtocolRelative: false
  });
};

const sanitizeSvg = (svgBuffer) => {
  if (!svgBuffer) return svgBuffer;

  const svgString = svgBuffer.toString('utf-8');
  
  // Sanitize specifically for SVG using sanitize-html
  const cleanSvg = sanitizeHtml(svgString, {
    allowedTags: [
      'svg', 'g', 'path', 'rect', 'circle', 'line', 'polyline', 'polygon',
      'text', 'tspan', 'title', 'desc', 'defs', 'use', 'style', 'xml'
    ],
    allowedAttributes: {
      '*': ['id', 'class', 'style', 'fill', 'stroke', 'stroke-width', 'transform', 'd', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'viewBox', 'xmlns', 'xml:space']
    }
  });

  return Buffer.from(cleanSvg, 'utf-8');
};

module.exports = {
  sanitizeContent,
  sanitizeSvg
};
