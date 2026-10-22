// CloudFront Function (viewer-request). The S3 REST endpoint has no index documents, so map
// directory-style URIs to the index.html that `trailingSlash: true` exports:
//   /          -> /index.html
//   /stats/    -> /stats/index.html
//   /stats     -> /stats/index.html   (no dot in the last segment: treat it as a directory)
//   /logo.svg  -> unchanged
// The query string (?code=...) is not part of event.request.uri, so it is left alone.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!lastSegment.includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}
