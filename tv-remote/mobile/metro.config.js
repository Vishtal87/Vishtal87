// Ядро протоколов лежит рядом, в ../src. Metro должен видеть эту папку.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../src')];

module.exports = config;
