Pod::Spec.new do |s|
  s.name = 'BuddyBeacon'
  s.version = '1.0.0'
  s.summary = 'Foreground EvacuAid Buddy Bluetooth transport'
  s.description = 'Foreground EvacuAid Buddy Bluetooth transport'
  s.license = { :type => 'MIT' }
  s.author = 'EvacuAid'
  s.homepage = 'https://expo.dev'
  s.platforms = { :ios => '16.4' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
