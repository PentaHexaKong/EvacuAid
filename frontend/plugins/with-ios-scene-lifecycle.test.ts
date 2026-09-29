const { adoptSceneDelegate, addSceneManifest } = require('./with-ios-scene-lifecycle') as {
  adoptSceneDelegate: (contents: string) => string;
  addSceneManifest: (plist: Record<string, unknown>) => Record<string, unknown>;
};

const sdk57AppDelegate = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

test('the SDK 57 app delegate hands window creation to the Expo scene delegate', () => {
  const patched = adoptSceneDelegate(sdk57AppDelegate);
  expect(patched).toContain('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
  expect(patched).not.toContain('UIWindow(frame:');
  expect(patched).not.toContain('startReactNative');
  expect(patched).toContain('reactNativeFactory = factory');
  expect(patched).toContain('return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
});

test('patching is idempotent, so a template that already adopts scenes is left alone', () => {
  const once = adoptSceneDelegate(sdk57AppDelegate);
  expect(adoptSceneDelegate(once)).toBe(once);
});

test('an unrecognised app delegate fails the build instead of producing an app that cannot launch', () => {
  expect(() => adoptSceneDelegate('@main\nclass AppDelegate: ExpoAppDelegate {\n}\n')).toThrow(/with-ios-scene-lifecycle/);
});

test('Info.plist declares one application scene backed by the Expo scene delegate', () => {
  expect(addSceneManifest({ CFBundleName: 'EvacuAid' })).toEqual({
    CFBundleName: 'EvacuAid',
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' }],
      },
    },
  });
});
