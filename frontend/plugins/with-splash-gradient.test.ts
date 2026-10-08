const { addGradientToStoryboard } = require('./with-splash-gradient') as { addGradientToStoryboard: (xml: any) => any };

// The shape expo-splash-screen 57 leaves behind: its logo, centred, over the container's background color.
const storyboard = () => ({ document: {
  scenes: [{ scene: [{ objects: [{ viewController: [{ view: [{
    subviews: [{ imageView: [{ $: { id: 'EXPO-SplashScreen', image: 'SplashScreenLogo' } }] }],
    constraints: [{ constraint: [{ $: { firstItem: 'EXPO-SplashScreen', firstAttribute: 'centerX' } }, { $: { firstItem: 'EXPO-SplashScreen', firstAttribute: 'centerY' } }] }],
  }] }] }] }] }],
  resources: [{ image: [{ $: { name: 'SplashScreenLogo' } }] }],
} });

const view = (xml: any) => xml.document.scenes[0].scene[0].objects[0].viewController[0].view[0];

it('puts the gradient under the logo, pinned to every edge, and keeps the logo centred', () => {
  const xml = addGradientToStoryboard(storyboard());
  expect(view(xml).subviews[0].imageView.map((item: any) => item.$.id)).toEqual(['EVACUAID-SplashGradient', 'EXPO-SplashScreen']);
  expect(view(xml).constraints[0].constraint.map((item: any) => `${item.$.firstItem}.${item.$.firstAttribute}`)).toEqual([
    'EXPO-SplashScreen.centerX', 'EXPO-SplashScreen.centerY',
    'EVACUAID-SplashGradient.top', 'EVACUAID-SplashGradient.bottom', 'EVACUAID-SplashGradient.leading', 'EVACUAID-SplashGradient.trailing',
  ]);
  expect(xml.document.resources[0].image.map((item: any) => item.$.name)).toEqual(['SplashScreenLogo', 'SplashScreenGradient']);
});

it('does not stack a second gradient when prebuild runs again', () => {
  const xml = addGradientToStoryboard(addGradientToStoryboard(storyboard()));
  expect(view(xml).subviews[0].imageView).toHaveLength(2);
  expect(view(xml).constraints[0].constraint).toHaveLength(6);
  expect(xml.document.resources[0].image).toHaveLength(2);
});
