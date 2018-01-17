var config = {
  entry: './src/webview.src.js',
  output: {
    filename: './build/webview.js',
    library: 'WebView',
    libraryTarget: 'var'
  },
  module:{
    loaders: [
      { test: /\.(png|woff|woff2|eot|ttf|svg)$/, loader: 'url-loader?limit=100000' }
    ]
  },
  resolve: {
      alias: {
          "jquery": "jquery"
      }
  }
};

module.exports = config;
