const path = require('path')

module.exports = {
  mode: 'development',
  entry: './frontend/index.js',
  output: {
    filename: '[name].bundle.js',
    chunkFilename: '[name].bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/',
  },
  devServer: {
    contentBase: [
      path.join(__dirname, 'static'),
      path.join(__dirname, 'dist'),
    ]
  },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
      {
        test: /\.css$/,
        use: [ 'style-loader', 'css-loader' ],
      },
      /*
      {
        test: /\.png$/,
        use: [ 'file-loader' ],
      },
      */
    ],
  },
}
