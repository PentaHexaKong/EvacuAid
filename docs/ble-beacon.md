# EvacuAid Bluetooth beacon v1

The Buddy nearby search exchanges this payload only while the search screen is visible and the app is in the foreground. A broadcast is discovery evidence; it does not authenticate a sender, accept help, or prove delivery. Broadcast coordinates and a stable ID are readable by anyone nearby. Server eligibility checks remain required before an online offer.

Nearby helpers do not need a saved Buddy relationship. Any signed-in user can turn on helper availability and broadcast while Auto search is open. Requesters broadcast after explicitly starting a nearby help search. Online offers and acceptance still require current helper availability, an open nearby request, and session consent. Accepting nearby help creates a help session; it does not automatically add a trusted Buddy contact.

## Payload

Exactly 15 bytes, little-endian:

| Offset | Field | Encoding |
| --- | --- | --- |
| 0 | Magic | `EA` |
| 1 | Version and role | High nibble `1`; low nibble `1` = needs help, `2` = helper here |
| 2–5 | Beacon ID | uint32, `1` through `FFFFFFFF` |
| 6–9 | Latitude | Signed int32, decimal degrees multiplied by 10,000,000 |
| 10–13 | Longitude | Signed int32, decimal degrees multiplied by 10,000,000 |
| 14 | Accuracy | Metres rounded up; `FF` = unknown or at least 255 m |

Latitude `7FFFFFFF` means no fix; ignore longitude when that sentinel is present. Encoders write the same sentinel to both coordinates. Otherwise latitude must be within ±90° and longitude within ±180°. Wrong length, magic, version, role, zero ID, invalid bytes or out-of-range coordinates are rejected. No-fix beacons remain discoverable using RSSI categories.

## Transports

Service UUID: `E8A00001-5D32-4F47-A5C1-9D7E2B3C1000`.

Read characteristic UUID: `E8A00002-5D32-4F47-A5C1-9D7E2B3C1000`.

Android and a future ESP32 advertise manufacturer data with company ID `FFFF` followed by the 15-byte payload. The manufacturer AD structure takes 19 bytes; with 3-byte flags, 22 of the legacy 31-byte advertisement limit are used. Android includes the 128-bit service UUID in its scan response. `FFFF` is the development transport identifier; a production accessory should review assigned company identifiers before distribution.

An iPhone advertises the service UUID and serves the payload from a read-only GATT characteristic. Apple permits service UUIDs and the local name in app peripheral advertising, so the payload cannot be advertised as manufacturer data. Both scanners accept manufacturer data first and use GATT for service UUID peers that have no usable manufacturer payload. Scan without a service filter in the foreground so manufacturer-only accessories are discoverable.

GATT reads connect, discover the service and characteristic, read once and disconnect. They allow at most three concurrent connections, time out after six seconds, and retry a peer after at least 15 seconds. The retry table holds at most 256 recently seen peers. A successful read or manufacturer packet emits raw payload bytes; failed reads never replay cached coordinates.

## Synthetic accessory fixture

Beacon ID `12345678`, needs help, latitude −1°, longitude 10°, accuracy 7 m (synthetic coordinates):

```text
Payload:             EA 11 78 56 34 12 80 69 67 FF 00 E1 F5 05 07
Manufacturer value: FF FF EA 11 78 56 34 12 80 69 67 FF 00 E1 F5 05 07
Advertisement:      02 01 06 12 FF FF FF EA 11 78 56 34 12 80 69 67 FF 00 E1 F5 05 07
Scan response:      11 07 00 10 3C 2B 7E 9D C1 A5 47 4F 32 5D 01 00 A0 E8
```

The first advertisement byte in each AD structure gives the following structure length, including the AD type. `FF` is manufacturer-specific data; `07` is a complete 128-bit service UUID list. UUID bytes in this advertisement are least-significant-byte first. Native scanners strip the two company-ID bytes before passing payloads to the TypeScript codec. The Jest fixture checks this future accessory contract; no ESP32 firmware is implemented.

## Timing and lifecycle

The app updates its payload every 10 seconds, treats fixes older than 30 seconds as unavailable, and removes people after 30 seconds without a fresh payload. Native transport stops scans, advertisements and connections when backgrounded, explicitly stopped or destroyed. It never resumes a search automatically after a background transition; the visible screen starts a new foreground search. RSSI categories default to near ≥−60 dBm, medium ≥−75 dBm, otherwise far. They are tunable signal categories, not measured metres. Distance uses two valid GPS fixes; direction uses the bearing and local heading.

Native state distinguishes actual scanning and advertising from starting, Bluetooth off, denied permission, unavailable hardware, idle and transport errors. The simulator reports unavailable. An old development build with no module also reports unavailable and needs rebuilding.

## Permissions and validation boundaries

iOS requires `NSBluetoothAlwaysUsageDescription`; Core Bluetooth prompts on first start. Android requests fine and coarse location together plus scan, connect and advertise permissions on Android 12 and newer; earlier versions request fine location and declare the legacy Bluetooth permissions. Location services must be enabled for scans that derive location. This feature deliberately does not assert `neverForLocation`: decoded GPS coordinates and proximity are location information, and Android warns that the flag can filter beacon results. Existing app foreground location permission is still needed to obtain the sender's GPS fix. On Android the no-fix/RSSI fallback means there is no fresh fix after permission is granted; denying location permission blocks this location-derived Bluetooth scan.

Protocol tests and compilation do not establish radio range or two-phone interoperability. Validate iPhone↔iPhone and iPhone↔Android on hardware, including permission denial, Bluetooth off, no GPS fix, foreground/background transitions and walking apart. One connected phone can verify native start/state/lifecycle, but cannot prove peer discovery or reception.

Platform references: [Android runtime location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime), [Android Bluetooth permissions](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions), [Apple peripheral advertising](https://developer.apple.com/documentation/corebluetooth/cbperipheralmanager/startadvertising(_:)), [Apple peripheral tasks](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/PerformingCommonPeripheralRoleTasks/PerformingCommonPeripheralRoleTasks.html).
