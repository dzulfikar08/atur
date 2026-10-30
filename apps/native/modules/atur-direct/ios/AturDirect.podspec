Pod::Spec.new do |s|
  s.name           = 'AturDirect'
  s.version        = '1.0.0'
  s.summary        = 'Direct Atur Terminal connection through a Rust core'
  s.description    = 'Expo module exposing the atur-mobile Rust core to the Atur app'
  s.license        = 'MIT'
  s.author         = 'Joyo Digitama'
  s.homepage       = 'https://atur.diatur.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/joyodigitama/atur.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.vendored_frameworks = 'Frameworks/AturMobile.xcframework'
  s.libraries = 'resolv'
  s.frameworks = 'AVFoundation', 'CoreMedia', 'CoreVideo', 'VideoToolbox', 'QuartzCore', 'UIKit'

  s.source_files = '*.{h,m,mm,swift}', 'Generated/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
