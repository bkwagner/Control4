// Expo config plugin: adds DirectorTrust.kt (pinned trust for the Control4
// Director's self-signed certificate, applied to React Native's fetch and
// WebSocket clients) and wires it into MainApplication. Runs during
// `expo prebuild`, so EAS cloud builds get it without a checked-in android/.

const fs = require('fs');
const path = require('path');
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');

function withDirectorTrustSource(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) throw new Error('with-director-trust: android.package is required');
      // eslint-disable-next-line no-undef -- Node build-time script
      const template = fs.readFileSync(path.join(__dirname, 'director-trust', 'DirectorTrust.kt'), 'utf8');
      const outDir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', ...pkg.split('.'));
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'DirectorTrust.kt'), template.replace('__PACKAGE__', pkg));
      return cfg;
    },
  ]);
}

function withDirectorTrustWiring(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('DirectorTrustPackage()')) {
      src = src.replace(
        /PackageList\(this\)\.packages\.apply \{/,
        (m) => `${m}\n              add(DirectorTrustPackage())`,
      );
    }
    if (!src.includes('DirectorTrust.install(')) {
      src = src.replace(/super\.onCreate\(\)/, (m) => `${m}\n    DirectorTrust.install(this)`);
    }
    if (!src.includes('DirectorTrustPackage()') || !src.includes('DirectorTrust.install(')) {
      throw new Error('with-director-trust: could not patch MainApplication');
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = function withDirectorTrust(config) {
  return withDirectorTrustWiring(withDirectorTrustSource(config));
};
