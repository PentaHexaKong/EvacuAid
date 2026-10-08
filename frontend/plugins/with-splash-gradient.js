const fs = require('fs');
const path = require('path');
const { withDangerousMod, withMod } = require('expo/config-plugins');

// iOS launch screens only take a solid color, so the gradient is a stretched image behind expo-splash-screen's logo.
// List this plugin before expo-splash-screen: mods run last-registered first, and that plugin rewrites the storyboard's views.
const IMAGE = 'SplashScreenGradient';
const VIEW_ID = 'EVACUAID-SplashGradient';
const CONTAINER_ID = 'EXPO-ContainerView';

function addGradientToStoryboard(xml) {
  const view = xml.document.scenes[0].scene[0].objects[0].viewController[0].view[0];
  if (!view?.subviews?.[0] || !view.constraints?.[0]) throw new Error('with-splash-gradient: SplashScreen.storyboard template changed; update this plugin');
  const imageViews = view.subviews[0].imageView ?? [];
  view.subviews[0].imageView = [
    { $: { id: VIEW_ID, userLabel: IMAGE, image: IMAGE, contentMode: 'scaleToFill', userInteractionEnabled: false, translatesAutoresizingMaskIntoConstraints: false }, rect: [{ $: { key: 'frame', x: 0, y: 0, width: 393, height: 852 } }] },
    ...imageViews.filter(item => item.$.id !== VIEW_ID),
  ];
  const constraints = (view.constraints[0].constraint ?? []).filter(item => item.$.firstItem !== VIEW_ID);
  for (const edge of ['top', 'bottom', 'leading', 'trailing']) {
    constraints.push({ $: { firstItem: VIEW_ID, firstAttribute: edge, secondItem: CONTAINER_ID, secondAttribute: edge, id: `${VIEW_ID}-${edge}` } });
  }
  view.constraints[0].constraint = constraints;
  const resources = xml.document.resources[0];
  resources.image = [...(resources.image ?? []).filter(item => item.$.name !== IMAGE), { $: { name: IMAGE, width: 390, height: 844 } }];
  return xml;
}

module.exports = (config, { image }) => withDangerousMod(
  withMod(config, { platform: 'ios', mod: 'splashScreenStoryboard', action: c => { c.modResults = addGradientToStoryboard(c.modResults); return c; } }),
  ['ios', c => {
    const imageset = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName, 'Images.xcassets', `${IMAGE}.imageset`);
    fs.mkdirSync(imageset, { recursive: true });
    fs.copyFileSync(path.join(c.modRequest.projectRoot, image), path.join(imageset, 'gradient.png'));
    fs.writeFileSync(path.join(imageset, 'Contents.json'), JSON.stringify({ images: [{ idiom: 'universal', filename: 'gradient.png' }], info: { version: 1, author: 'expo' } }, null, 2));
    return c;
  }],
);
module.exports.addGradientToStoryboard = addGradientToStoryboard;
