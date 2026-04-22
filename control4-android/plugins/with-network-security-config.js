const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withNetworkSecurityConfig(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults;
    const mainApplication = manifest.manifest.application[0];

    if (!mainApplication.$) {
      mainApplication.$ = {};
    }

    // Add networkSecurityConfig attribute
    mainApplication.$['android:networkSecurityConfig'] = '@xml/network_security_config';

    return config;
  });
};
