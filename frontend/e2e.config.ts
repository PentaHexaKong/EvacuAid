import type { E2EConfig } from 'e2e';
import { mobile } from '@e2e-dev/mobile';
import { mobileTools } from '@e2e-dev/mobile/tools';
import { chatgpt } from 'e2e/oauth/chatgpt';

// The dev build loads its bundle from Metro: start it first (npm start) or point E2E_METRO_URL at the one already running.
const metro = process.env.E2E_METRO_URL ?? 'http://localhost:8081';

const iphone = mobile({ platform: 'ios' });

export default {
  targets: [{
    name: 'ios',
    engine: iphone,
    app: {
      bundleId: process.env.IOS_BUNDLE_IDENTIFIER || 'dev.evacuaid.foundation',
      // English on a fresh install; a saved in-app language preference still wins (tests switch it themselves).
      launchArguments: ['-AppleLanguages', '(en)', '-AppleLocale', 'en_US', '--initialUrl', metro, '-EXDevMenuShowsAtLaunch', 'NO', '-EXDevMenuIsOnboardingFinished', 'YES', '-EXDevMenuShowFloatingActionButton', 'NO'],
    },
  }],
  workers: 1,
  // Agent steps run on the ChatGPT subscription signed in with `npx e2e login openai`; CI needs an API key provider instead.
  agents: { default: { model: chatgpt('gpt-6-luna'), tools: mobileTools(iphone) } },
} satisfies E2EConfig;
