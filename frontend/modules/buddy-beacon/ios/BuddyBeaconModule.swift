import CoreBluetooth
import ExpoModulesCore
import UIKit

struct BeaconStartOptions: Record {
  @Field var payload: [Int] = []
  @Field var advertise: Bool = false
}

public class BuddyBeaconModule: Module {
  private lazy var transport = BeaconTransport { [weak self] event, body in self?.sendEvent(event, body) }

  public func definition() -> ModuleDefinition {
    Name("BuddyBeacon")
    Events("onBeacon", "onState")
    AsyncFunction("start") { (options: BeaconStartOptions) -> [String: Any] in
      try self.transport.start(options.payload, advertise: options.advertise)
      return self.transport.state()
    }.runOnQueue(.main)
    AsyncFunction("update") { (payload: [Int]) in try self.transport.update(payload) }.runOnQueue(.main)
    AsyncFunction("stop") { self.transport.stop() }.runOnQueue(.main)
    AsyncFunction("getState") { self.transport.state() }.runOnQueue(.main)
    OnAppEntersBackground { self.transport.stop() }
    OnDestroy {
      let transport = self.transport
      DispatchQueue.main.async { transport.stop() }
    }
  }
}

private final class BeaconTransport: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate, CBPeripheralDelegate {
  private let serviceID = CBUUID(string: "E8A00001-5D32-4F47-A5C1-9D7E2B3C1000")
  private let characteristicID = CBUUID(string: "E8A00002-5D32-4F47-A5C1-9D7E2B3C1000")
  private let emit: (String, [String: Any]) -> Void
  private var central: CBCentralManager?
  private var peripheralManager: CBPeripheralManager?
  private var payload = Data()
  private var active = false
  private var advertise = false
  private var serviceReady = false
  private var addingService = false
  private var advertisingPending = false
  private var error: String?
  private var peers: [UUID: CBPeripheral] = [:]
  private var lastRead: [UUID: Date] = [:]
  private var signals: [UUID: Int] = [:]
  private var deadlines: [UUID: DispatchWorkItem] = [:]

  init(emit: @escaping (String, [String: Any]) -> Void) { self.emit = emit }

  func state() -> [String: Any] {
    var status = "idle"
    #if targetEnvironment(simulator)
    status = "unavailable"
    #else
    if CBManager.authorization == .denied || CBManager.authorization == .restricted { status = "unauthorized" }
    else if central?.state == .unsupported { status = "unavailable" }
    else if central?.state == .poweredOff { status = "off" }
    else if let _ = error { status = "error" }
    else if central?.isScanning == true { status = "scanning" }
    else if active { status = "starting" }
    #endif
    var result: [String: Any] = ["status": status, "scanning": central?.isScanning ?? false, "advertising": peripheralManager?.isAdvertising ?? false]
    if let error { result["error"] = error }
    return result
  }

  private func report() { emit("onState", state()) }
  private func bytes(_ values: [Int]) throws -> Data {
    guard values.count == 15, values.allSatisfy({ (0...255).contains($0) }) else {
      throw NSError(domain: "BuddyBeacon", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected 15 payload bytes"])
    }
    return Data(values.map(UInt8.init))
  }

  func start(_ values: [Int], advertise: Bool) throws {
    payload = try bytes(values)
    #if targetEnvironment(simulator)
    report()
    return
    #else
    guard UIApplication.shared.applicationState == .active else { stop(); return }
    error = nil
    active = true
    self.advertise = advertise
    if central == nil { central = CBCentralManager(delegate: self, queue: .main, options: [CBCentralManagerOptionShowPowerAlertKey: false]) }
    if advertise && peripheralManager == nil { peripheralManager = CBPeripheralManager(delegate: self, queue: .main, options: [CBPeripheralManagerOptionShowPowerAlertKey: false]) }
    if !advertise { peripheralManager?.stopAdvertising(); advertisingPending = false }
    resume()
    #endif
  }

  func update(_ values: [Int]) throws { payload = try bytes(values) }

  func stop() {
    active = false
    advertise = false
    central?.stopScan()
    peripheralManager?.stopAdvertising()
    advertisingPending = false
    for peer in Array(peers.values) { finish(peer) }
    lastRead.removeAll()
    signals.removeAll()
    report()
  }

  private func resume() {
    guard active else { report(); return }
    if central?.state == .poweredOn && central?.isScanning == false {
      central?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }
    if advertise, let manager = peripheralManager, manager.state == .poweredOn {
      if !serviceReady && !addingService {
        manager.removeAllServices()
        let characteristic = CBMutableCharacteristic(type: characteristicID, properties: [.read], value: nil, permissions: [.readable])
        let service = CBMutableService(type: serviceID, primary: true)
        service.characteristics = [characteristic]
        addingService = true
        manager.add(service)
      } else if serviceReady && !manager.isAdvertising && !advertisingPending {
        advertisingPending = true
        manager.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [serviceID]])
      }
    }
    report()
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    if central.state != .poweredOn {
      for peer in Array(peers.values) { finish(peer) }
    }
    resume()
  }

  func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
    if peripheral.state != .poweredOn {
      serviceReady = false
      addingService = false
      advertisingPending = false
    }
    resume()
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
    addingService = false
    if let error { self.error = error.localizedDescription; report(); return }
    serviceReady = true
    resume()
  }

  func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
    advertisingPending = false
    if let error { self.error = error.localizedDescription }
    if !active || !advertise { peripheral.stopAdvertising() }
    report()
  }

  func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveRead request: CBATTRequest) {
    guard active && advertise && request.characteristic.uuid == characteristicID else {
      peripheral.respond(to: request, withResult: .readNotPermitted); return
    }
    guard request.offset <= payload.count else { peripheral.respond(to: request, withResult: .invalidOffset); return }
    request.value = payload.subdata(in: request.offset..<payload.count)
    peripheral.respond(to: request, withResult: .success)
  }

  func centralManager(_ central: CBCentralManager, didDiscover peer: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    guard active else { return }
    if let data = advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data,
       data.count == 17, data[0] == 0xff, data[1] == 0xff {
      emit("onBeacon", ["deviceId": peer.identifier.uuidString, "payload": Array(data.dropFirst(2)).map(Int.init), "rssi": RSSI.intValue])
      return
    }
    let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []) + (advertisementData[CBAdvertisementDataOverflowServiceUUIDsKey] as? [CBUUID] ?? [])
    guard services.contains(serviceID), peers[peer.identifier] == nil, peers.count < 3,
          Date().timeIntervalSince(lastRead[peer.identifier] ?? .distantPast) >= 15 else { return }
    if lastRead.count >= 256 { lastRead = lastRead.filter { Date().timeIntervalSince($0.value) < 30 } }
    guard lastRead.count < 256 else { return }
    lastRead[peer.identifier] = Date()
    signals[peer.identifier] = RSSI.intValue
    peers[peer.identifier] = peer
    peer.delegate = self
    let deadline = DispatchWorkItem { [weak self, weak peer] in if let peer { self?.finish(peer) } }
    deadlines[peer.identifier] = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + 6, execute: deadline)
    central.connect(peer)
  }

  private func finish(_ peer: CBPeripheral) {
    deadlines.removeValue(forKey: peer.identifier)?.cancel()
    peers.removeValue(forKey: peer.identifier)
    signals.removeValue(forKey: peer.identifier)
    peer.delegate = nil
    if peer.state != .disconnected { central?.cancelPeripheralConnection(peer) }
  }

  func centralManager(_ central: CBCentralManager, didConnect peer: CBPeripheral) {
    guard active && peers[peer.identifier] != nil else { finish(peer); return }
    peer.discoverServices([serviceID])
  }
  func centralManager(_ central: CBCentralManager, didFailToConnect peer: CBPeripheral, error: Error?) { finish(peer) }
  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peer: CBPeripheral, error: Error?) { finish(peer) }
  func peripheral(_ peer: CBPeripheral, didDiscoverServices error: Error?) {
    guard active, error == nil, let service = peer.services?.first(where: { $0.uuid == serviceID }) else { finish(peer); return }
    peer.discoverCharacteristics([characteristicID], for: service)
  }
  func peripheral(_ peer: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    guard active, error == nil, let characteristic = service.characteristics?.first(where: { $0.uuid == characteristicID && $0.properties.contains(.read) }) else { finish(peer); return }
    peer.readValue(for: characteristic)
  }
  func peripheral(_ peer: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    if active, peers[peer.identifier] != nil, error == nil, characteristic.uuid == characteristicID, let data = characteristic.value, data.count == 15 {
      emit("onBeacon", ["deviceId": peer.identifier.uuidString, "payload": data.map(Int.init), "rssi": signals[peer.identifier] ?? -127])
    }
    finish(peer)
  }
}
