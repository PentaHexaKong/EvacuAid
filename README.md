# EvacuAid

**An inclusive disaster companion for Indonesia.** EvacuAid explains official warnings in plain language, connects people with someone who can help, and guides them toward a gathering point, while stating what is known and what is not.

It is built first for people who are often left behind in an evacuation: blind and low-vision people, deaf and hard-of-hearing people, people with limited mobility, and older adults.

There are two parts: an **iPhone app** for residents and their helpers, and a **Command Center** web dashboard for government responders. Both talk to the same backend, which we host.

> [!IMPORTANT]
> **This is a hackathon prototype, tested on iPhone only. There is no TestFlight or App Store build.** To try the app you build it from this repository on a Mac (about 30 minutes the first time). Read [Current demo scope and limitations](#current-demo-scope-and-limitations) before testing, so you know what to expect.

| | |
| --- | --- |
| **Command Center** | [evacuaid.dftrg.com/command-center](https://evacuaid.dftrg.com/command-center/) (opens in any desktop browser, no login) |
| **Backend API** | `https://apieva.dftrg.com` (the app connects to it; you don't need to open it) |

## How it fits together

```text
iPhone app (Expo / React Native)  ──►  Backend API (FastAPI)  ──►  PostgreSQL + PostGIS, Redis, Valhalla routing
                                            ▲                 ──►  BMKG, PetaBencana, InaRISK
Command Center (web)  ──────────────────────┘
```

| Folder | Contents |
| --- | --- |
| `frontend/` | The mobile app (Expo SDK 57, React Native, Expo Router) |
| `backend/` | The API (Python, FastAPI, Alembic migrations) |
| `testocando/` | The Command Center dashboard and its API routes |
| `docker-compose.yml` | Runs the backend, database, cache, routing and dashboard together |

---

## Install on an iPhone

You build the app on a Mac and install it over a USB cable. The finished app talks to our hosted backend, so after installing, the iPhone works on its own: any network, no Mac needed.

### What you need

- A **Mac** with **[Xcode](https://apps.apple.com/app/xcode/id497799835)** (open it once and accept the license)
- **[Node.js](https://nodejs.org/) 22 or newer**
- **CocoaPods**: `brew install cocoapods`
- An **iPhone** and its USB cable
- An **Apple ID**. A free one works.

### 1. Get the code and point it at our backend

```bash
git clone https://github.com/PentaHexaKong/EvacuAid.git
cd EvacuAid/frontend
cat > .env <<EOF
EXPO_PUBLIC_API_BASE_URL=https://apieva.dftrg.com
IOS_BUNDLE_IDENTIFIER=com.yourname.evacuaid
EOF
```

Replace `yourname` with anything. Bundle IDs are unique per Apple account, so you need your own.

### 2. Generate the Xcode project

```bash
npm ci
npx expo prebuild -p ios
open ios/EvacuAid.xcworkspace
```

Open the `.xcworkspace` file, not the `.xcodeproj`.

### 3. Sign and build in Xcode

1. **Sign in.** Go to **Xcode › Settings › Accounts**, click **+**, and add your Apple ID.
2. **Pick your team.** In the left sidebar, click the blue **EvacuAid** project, select the **EvacuAid** target, and open **Signing & Capabilities**. Turn on **Automatically manage signing** and set **Team** to your name.
3. **Using a free Apple ID?** Remove the **Push Notifications** capability by clicking the trash icon next to it. Free accounts can't sign push. Nothing is lost, because push is not available in self-built copies anyway (see [limitations](#current-demo-scope-and-limitations)).
4. **Build a standalone app.** Choose **Product › Scheme › Edit Scheme…**, then **Run › Build Configuration › Release**. A Release build contains everything it needs and runs without a development server.
5. **Connect the iPhone** with the cable, unlock it, and tap **Trust** if it asks.
6. **Turn on Developer Mode** on the iPhone: **Settings › Privacy & Security › Developer Mode › On**. The iPhone restarts. The option only appears after the phone has been connected to Xcode.
7. In the Xcode toolbar, choose your iPhone as the run destination and press **▶ Run** (⌘R).

The first build takes 5–15 minutes.

### 4. Open the app

1. **Trust yourself as a developer** (free Apple ID only). The first launch is blocked with "Untrusted Developer". Go to **Settings › General › VPN & Device Management**, tap your Apple ID, then **Trust**.
2. **Open EvacuAid** and allow **Location**, **Bluetooth** and **Microphone** when asked. They are needed for warnings, nearby help and voice.
3. Tap **Continue as guest**. No account is needed. (You can also create one; passwords need at least 12 characters.)
4. The app follows your phone's language: English if your phone is in English, Indonesian otherwise. You can switch in Profile › **Language**.

> [!NOTE]
> A build signed with a free Apple ID stops opening after **7 days**. Connect the phone and press ▶ Run in Xcode again to renew it.

### Optional: the iOS Simulator

No iPhone? Follow the same steps, but in step 3 choose an iPhone simulator as the run destination (signing steps 1–3 and 5–6 aren't needed). Then set its location to Jakarta, where our demo data is: **Features › Location › Custom Location…**, latitude `-6.2`, longitude `106.8`. Bluetooth, the microphone and haptics don't work in the Simulator.

### Android

**Not supported in this demo.** We focused development and testing on the iPhone. There is no APK, and we have not built or tested the app on Android. The code is cross-platform, so an Android version is possible later, but expect it to be unfinished if you build it yourself ([`frontend/README.md`](frontend/README.md)).

### Troubleshooting

| Problem | Fix |
| --- | --- |
| **"Can't reach the API"** in the app | Check the phone has internet, and that `curl https://apieva.dftrg.com/health` answers. If you changed `frontend/.env` after building, build again: a Release app keeps the address it was built with. |
| **"Guest mode is not available on this server"** | Guest sign-in is switched off on the server. Tap **Sign in or create account** and create one instead, and tell us. |
| Xcode: **"Personal development teams … do not support the Push Notifications capability"** | Do step 3.3. |
| Xcode: **"Failed to register bundle identifier"** | That bundle ID is taken. Choose a different `IOS_BUNDLE_IDENTIFIER` in `frontend/.env`, run `npx expo prebuild -p ios --clean`, and repeat step 3. |
| Xcode can't see the iPhone | Unlock it, accept **Trust This Computer**, and check that Developer Mode is on (step 3.6). |
| The map shows plain Apple Maps | Expected. The styled map needs our Mapbox token, which isn't in the repository. Lists and sheets carry the same information. |

---

## What you can test

The app opens on **Home**. The tabs are **Home**, **Discover**, **Alerts** and **Buddy**; your profile and settings are behind the person icon at the top right.

### iPhone app

| Feature | Where | What to expect | Needs a real iPhone? |
| --- | --- | --- | --- |
| Guest entry and setup | First launch | Choose a language, your accessibility needs and location access. The tabs and layout adapt to the needs you pick. | No |
| Warnings that mean something | **Home**, **Alerts** | Official warnings for your area, in plain language, with what to do next. Real warnings are rare, so use a mock disaster (see the walkthrough below). | No |
| Respond to a warning | Open a warning | **I'm safe**, **I need help**, or **Start evacuation**. | No |
| Evacuate | **Discover**, or **Start evacuation** | Nearby gathering points, a walking route and step-by-step guidance. Only works in Jakarta. | No (set the Simulator's location) |
| Buddy | **Buddy** › **Add Buddy** | Invite someone by code or QR, ask them for help, and follow each other on a map while a request is active. Needs two phones or one phone and the Simulator, each with its own account. | No |
| Nearby help over Bluetooth | **Buddy**, turn on **I am available to help** on one phone, start a nearby help search on the other | The two phones find each other without being Buddies. Active only while the screen is open. | **Yes, two iPhones** |
| Voice | Choose a vision need in setup, then **Buddy** | Say "help", "nearby" or "status" instead of tapping. Warnings are read aloud. | **Yes** (microphone) |
| Field reports and check-ins | Profile › **Field reports & evacuation updates** | Report a blocked road or flooding, or check in as evacuating or safe. Reports wait in an outbox and retry if you're offline. | No |
| Government routes and dispatch | Same screen | Routes published from the Command Center, and responses to your own help requests. | No |
| Downloaded regions | Profile › **Downloaded regions** | Download a map region for offline viewing. One region exists (Cipete Selatan, about 79 MB). | No |
| Profile and accessibility | Profile | Language, accessibility needs, larger text, stronger contrast, voice guidance, location sharing. | No |
| Delete account | Profile, bottom of the page | Permanently deletes an account (not available for guest profiles). | No |

### Command Center

| Feature | Where | What to expect |
| --- | --- | --- |
| Overview | **Overview** | Jakarta regions on a map with live hazard, shelter and assistance counts. |
| Mock disasters | **Overview** › **Mock mode** › **Add mock disaster**, then click the map | A test hazard circle. Phones whose location is inside the circle get a warning. **Elevated** and **Critical** warnings ask the user to act; **Watch** only informs. |
| Field reports | **Field reports** | Reports from phones. Confirm, reject or resolve them. A confirmed blocked road is avoided by new routes. |
| Assistance | **Assistance** | Help requests from phones. Acknowledge, dispatch, complete, or assign a published route. |
| Check-ins | **Check-ins** | Counts of self-reported statuses per region over the last 24 hours. |
| Route setter | **Route setter** | Calculate a route from an assembly point to a shelter, then publish or withdraw it. Phones see published routes. |

### A five-minute walkthrough

You need the app (iPhone or Simulator) and the Command Center open side by side.

1. On the phone, finish setup and allow location. Make sure your location is in Jakarta.
2. In the Command Center, open **Overview**, turn on **Mock mode**, click **Add mock disaster**, set severity to **Critical**, and click the map over the phone's location.
3. On the phone, open **Alerts**. The mock warning appears with what to do next. (Keep the app open. It checks about once a minute.)
4. Tap **I need help**.
5. In the Command Center, open **Assistance**. The request is there. **Acknowledge** it, then **Dispatch**.
6. On the phone, open Profile › **Field reports & evacuation updates**. Your request shows the dispatch update.
7. Back in **Overview**, click **Clear mock items** when you're done.

---

## Current demo scope and limitations

What follows is honest about what this prototype does not do yet. If something here surprises you during testing, it is expected.

### Platform and installation

- **iPhone only.** We focused development on the iPhone. **We did not develop for Android**: there is no APK, and the Android version has not been built or tested.
- **No TestFlight or App Store.** You build and install it yourself (see [Install on an iPhone](#install-on-an-iphone)). With a free Apple ID the app expires after 7 days.
- Portrait and light mode only. No iPad layout.

### Where it works

- **Jakarta only.** The demo data covers Jakarta: 318 reference regions and sample gathering points labeled **"Contoh"** (example). Outside Jakarta, Evacuate finds no gathering point, and region counts in the Command Center stay empty. Warnings and Buddy work anywhere.
- Walking routes come from OpenStreetMap data for Java.

### Warnings and notifications

- **Real warnings come only from official BMKG warnings at the "Siaga" or "Awas" level** for your area, which are rare. Use Command Center mock disasters to see the warning flow.
- **No push notifications.** Push needs our Expo account and is not in self-built copies. Warnings and Buddy requests arrive **while the app is open**, not on the lock screen.
- Mock disasters are real test warnings: any phone inside the circle receives one, including other testers' phones.

### Needs a physical iPhone

- Bluetooth nearby help, the microphone (voice commands), haptics and real GPS. The Simulator reports these as unavailable.

### Bluetooth nearby help

- Works only while the Buddy screen is open, not in the background.
- **Tested between two real iPhones.** iPhone-to-Android is implemented but has not been tried.
- Anyone nearby can read the approximate location a phone broadcasts while searching.
- A request is only sent once the internet is available. Bluetooth finds people; it doesn't deliver messages.

### Offline

- One downloadable region exists (Cipete Selatan). It shows the map and gathering points offline.
- **Offline route calculation is not built.** Guidance needs a connection.
- Field reports and check-ins are queued on the phone and sent when the connection returns.

### Accounts

- Guest profiles live on one phone. Signing out or reinstalling loses them.
- There is no password reset and no email verification.

### Command Center

- **No login.** It is open to anyone with the link during the demo, so other testers' actions (reviews, dispatches, published routes, mock disasters) are visible to you and vice versa.
- Data may be reset between demo sessions.
- Mock safe houses are stored in your browser only. Phones don't see them.

### What EvacuAid does not claim

- **Routes are not certified safe.** A route avoids known hazards and confirmed closures, nothing more, and it expires 5 minutes after it was calculated.
- Gathering points show reference capacity and reported accessibility, not live occupancy.
- Check-ins are self-reported and are not proof of safety.
- Accessibility adapts to the needs a user declares. It has not been independently audited. Wheelchair routes avoid steps where OpenStreetMap records them, but that data is not verified on the ground.
- EvacuAid is not affiliated with BMKG or BNPB.

### Not built yet

- An Android release, and TestFlight or App Store distribution
- Push notifications in distributed builds
- Offline route calculation
- Bluetooth in the background, and the ESP32 beacon hardware described in [`docs/ble-beacon.md`](docs/ble-beacon.md)
- Warnings by SMS or WhatsApp
- Automatic dispatch of help requests
- Real shelter data beyond the Jakarta samples, and other cities
- Command Center login and roles
- Languages other than Indonesian and English

---

## For developers

- [`frontend/README.md`](frontend/README.md): running a development build against a local backend, Android, scripts and tests
- [`backend/README.md`](backend/README.md): API endpoints, migrations and backend tests
- [`backend/AUTHENTICATION.md`](backend/AUTHENTICATION.md): accounts, tokens and roles
- [`testocando/README.md`](testocando/README.md): Command Center and region data
- [`VPS_DEPLOYMENT.md`](VPS_DEPLOYMENT.md): deploying and updating the backend and dashboard on a server
- [`FIELD_OPERATIONS.md`](FIELD_OPERATIONS.md), [`OFFLINE_NAVIGATION.md`](OFFLINE_NAVIGATION.md), [`docs/ble-beacon.md`](docs/ble-beacon.md): design notes
