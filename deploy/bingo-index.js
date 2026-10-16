// CloudFront Function (viewer request) on the /bingo* behaviour of the crystalmark.co.uk distribution; deploy/cloudfront.sh
// publishes it. The S3 origin has no index documents, so /bingo/ becomes /bingo/index.html, and so do the app's own
// routes (/bingo/KPTZ, a game; /bingo/solo): any path whose last part has no file extension. /bingo gets its slash.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri === '/bingo') {
    return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: '/bingo/' } } };
  }
  var last = uri.substring(uri.lastIndexOf('/') + 1);
  if (last === '' || last.indexOf('.') === -1) request.uri = '/bingo/index.html';
  return request;
}
