const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const WINDOW_START = /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n\n?/;

function adoptSceneDelegate(contents) {
  if (contents.includes('ExpoReactNativeFactoryProvider')) return contents;
  if (!WINDOW_START.test(contents)) throw new Error('with-ios-scene-lifecycle: AppDelegate template changed; update or remove this plugin');
  return contents
    .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
    .replace(WINDOW_START, '');
}

function addSceneManifest(plist) {
  plist.UIApplicationSceneManifest = {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' }] },
  };
  return plist;
}

module.exports = config => withInfoPlist(
  withAppDelegate(config, c => { c.modResults.contents = adoptSceneDelegate(c.modResults.contents); return c; }),
  c => { c.modResults = addSceneManifest(c.modResults); return c; },
);
module.exports.adoptSceneDelegate = adoptSceneDelegate;
module.exports.addSceneManifest = addSceneManifest;
