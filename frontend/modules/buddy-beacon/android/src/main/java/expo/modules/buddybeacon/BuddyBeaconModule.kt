package expo.modules.buddybeacon

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.UUID

class BeaconStartOptions : Record {
  @Field var payload: List<Int> = emptyList()
  @Field var advertise: Boolean = false
}

class BuddyBeaconModule : Module() {
  private val handler = Handler(Looper.getMainLooper())
  private val serviceId = UUID.fromString("E8A00001-5D32-4F47-A5C1-9D7E2B3C1000")
  private val characteristicId = UUID.fromString("E8A00002-5D32-4F47-A5C1-9D7E2B3C1000")
  private var active = false
  private var scanning = false
  private var advertising = false
  private var advertisingPending = false
  private var advertise = false
  private var payload = byteArrayOf()
  private var error: String? = null
  private var receiverRegistered = false
  private var scanCallback: ScanCallback? = null
  private var advertiseCallback: AdvertiseCallback? = null
  private val connections = mutableMapOf<String, BluetoothGatt>()
  private val deadlines = mutableMapOf<String, Runnable>()
  private val lastRead = mutableMapOf<String, Long>()
  private val signals = mutableMapOf<String, Int>()
  private val context get() = requireNotNull(appContext.reactContext)
  private val adapter: BluetoothAdapter? get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
  private val stateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
      if (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) != BluetoothAdapter.STATE_ON) stopTransport(false)
      else if (active) begin()
      report()
    }
  }

  override fun definition() = ModuleDefinition {
    Name("BuddyBeacon")
    Events("onBeacon", "onState")
    AsyncFunction("start") { options: BeaconStartOptions ->
      payload = bytes(options.payload)
      advertise = options.advertise
      active = true
      error = null
      if (!receiverRegistered) {
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(stateReceiver, filter, Context.RECEIVER_EXPORTED)
        else context.registerReceiver(stateReceiver, filter)
        receiverRegistered = true
      }
      begin()
      state()
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("update") { values: List<Int> ->
      payload = bytes(values)
      if (active && advertise && hasPermissions()) bluetoothAction { stopAdvertising(); beginAdvertising() }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { stopTransport(true); report() }.runOnQueue(Queues.MAIN)
    AsyncFunction("getState") { state() }.runOnQueue(Queues.MAIN)
    OnActivityEntersBackground { stopTransport(true); report() }
    OnDestroy {
      stopTransport(true)
      if (receiverRegistered) { context.unregisterReceiver(stateReceiver); receiverRegistered = false }
    }
  }

  private fun bytes(values: List<Int>): ByteArray {
    require(values.size == 15 && values.all { it in 0..255 }) { "Expected 15 payload bytes" }
    return values.map { it.toByte() }.toByteArray()
  }

  private fun hasPermissions(): Boolean {
    val required = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
    if (Build.VERSION.SDK_INT >= 31) required.addAll(listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE))
    return required.all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
  }

  private fun state(): Map<String, Any> {
    val status = when {
      !context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE) || adapter == null -> "unavailable"
      !hasPermissions() -> "unauthorized"
      adapter?.isEnabled != true -> "off"
      error != null -> "error"
      scanning -> "scanning"
      active -> "starting"
      else -> "idle"
    }
    val result = mutableMapOf<String, Any>("status" to status, "scanning" to scanning, "advertising" to advertising)
    error?.let { result["error"] = it }
    return result
  }

  private fun report() { sendEvent("onState", state()) }

  private fun bluetoothAction(action: () -> Unit) {
    try { action() }
    catch (_: SecurityException) { error = "permission_denied"; stopTransport(false); report() }
  }

  private fun begin() {
    if (!active || !hasPermissions() || adapter?.isEnabled != true) { report(); return }
    val location = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val locationEnabled = if (Build.VERSION.SDK_INT >= 28) location.isLocationEnabled else location.isProviderEnabled(LocationManager.GPS_PROVIDER) || location.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    if (!locationEnabled) { error = "location_disabled"; report(); return }
    error = null
    try {
      if (!scanning) {
        val scanner = adapter?.bluetoothLeScanner
        if (scanner == null) { error = "scanner_unavailable"; report(); return }
        val callback = object : ScanCallback() {
          override fun onScanResult(callbackType: Int, result: ScanResult) { handler.post { if (scanCallback === this) discovered(result) } }
          override fun onBatchScanResults(results: MutableList<ScanResult>) { handler.post { if (scanCallback === this) results.forEach { discovered(it) } } }
          override fun onScanFailed(errorCode: Int) { handler.post {
            if (scanCallback === this) { scanning = false; scanCallback = null; error = "scan_failed_$errorCode"; report() }
          } }
        }
        scanCallback = callback
        scanner.startScan(emptyList(), ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
        scanning = true
      }
      if (advertise) beginAdvertising() else stopAdvertising()
    } catch (_: SecurityException) { error = "permission_denied"; stopTransport(false) }
    catch (failure: Exception) { error = failure.message ?: "bluetooth_failed"; stopTransport(false) }
    report()
  }

  private fun beginAdvertising() {
    if (advertising || advertisingPending || !active || !advertise || adapter?.isEnabled != true) return
    val advertiser = adapter?.bluetoothLeAdvertiser
    if (advertiser == null) { error = "advertiser_unavailable"; report(); return }
    val callback = object : AdvertiseCallback() {
      override fun onStartSuccess(settingsInEffect: AdvertiseSettings) { handler.post {
        if (advertiseCallback === this && active && advertise) { advertisingPending = false; advertising = true; report() }
      } }
      override fun onStartFailure(errorCode: Int) { handler.post {
        if (advertiseCallback === this) { advertisingPending = false; advertising = false; advertiseCallback = null; error = "advertise_failed_$errorCode"; report() }
      } }
    }
    advertiseCallback = callback
    advertisingPending = true
    advertiser.startAdvertising(
      AdvertiseSettings.Builder().setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY).setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM).setConnectable(false).build(),
      AdvertiseData.Builder().addManufacturerData(0xffff, payload).build(),
      AdvertiseData.Builder().addServiceUuid(ParcelUuid(serviceId)).build(), callback,
    )
  }

  private fun stopAdvertising() {
    try { advertiseCallback?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) } } catch (_: SecurityException) { }
    advertiseCallback = null
    advertising = false
    advertisingPending = false
  }

  private fun stopTransport(clearActive: Boolean) {
    if (clearActive) { active = false; advertise = false; lastRead.clear() }
    try { scanCallback?.let { adapter?.bluetoothLeScanner?.stopScan(it) } } catch (_: SecurityException) { }
    scanCallback = null
    scanning = false
    stopAdvertising()
    connections.keys.toList().forEach { finish(it) }
  }

  private fun discovered(result: ScanResult) {
    if (!active || !scanning) return
    if (!hasPermissions()) { stopTransport(false); report(); return }
    bluetoothAction { readPeer(result) }
  }

  private fun readPeer(result: ScanResult) {
    val record = result.scanRecord ?: return
    val id = result.device.address
    val data = record.getManufacturerSpecificData(0xffff)
    if (data?.size == 15) {
      sendEvent("onBeacon", mapOf("deviceId" to id, "payload" to data.map { it.toInt() and 255 }, "rssi" to result.rssi))
      return
    }
    val now = System.currentTimeMillis()
    if (record.serviceUuids?.contains(ParcelUuid(serviceId)) != true || connections.containsKey(id) || connections.size >= 3 || now - (lastRead[id] ?: 0L) < 15000L) return
    if (lastRead.size >= 256) lastRead.entries.removeAll { now - it.value >= 30000L }
    if (lastRead.size >= 256) return
    lastRead[id] = now
    signals[id] = result.rssi
    val callback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) { handler.post {
        bluetoothAction {
          if (connections[id] !== gatt) gatt.close()
          else if (active && status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
            if (!gatt.discoverServices()) finish(id)
          } else if (status != BluetoothGatt.GATT_SUCCESS || newState == BluetoothProfile.STATE_DISCONNECTED) finish(id)
        }
      } }
      override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) { handler.post {
        if (connections[id] !== gatt) return@post
        bluetoothAction {
          val characteristic = gatt.getService(serviceId)?.getCharacteristic(characteristicId)
          if (!active || status != BluetoothGatt.GATT_SUCCESS || characteristic == null || !gatt.readCharacteristic(characteristic)) finish(id)
        }
      } }
      override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
        if (Build.VERSION.SDK_INT < 33) read(gatt, characteristic, characteristic.value, status)
      }
      override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray, status: Int) { read(gatt, characteristic, value, status) }
      private fun read(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, data: ByteArray?, status: Int) { handler.post {
        if (connections[id] !== gatt) return@post
        if (active && status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == characteristicId && data?.size == 15) {
          sendEvent("onBeacon", mapOf("deviceId" to id, "payload" to data.map { it.toInt() and 255 }, "rssi" to (signals[id] ?: -127)))
        }
        finish(id)
      } }
    }
    try {
      val gatt = result.device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
      if (gatt == null) { signals.remove(id); return }
      connections[id] = gatt
      val timeout = Runnable { finish(id) }
      deadlines[id] = timeout
      handler.postDelayed(timeout, 6000L)
    } catch (_: SecurityException) { error = "permission_denied"; stopTransport(false); report() }
  }

  private fun finish(id: String) {
    deadlines.remove(id)?.let { handler.removeCallbacks(it) }
    signals.remove(id)
    val gatt = connections.remove(id) ?: return
    try { gatt.disconnect() } catch (_: SecurityException) { }
    try { gatt.close() } catch (_: SecurityException) { }
  }
}
