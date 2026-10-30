Pod::Spec.new do |s|
  s.name           = 'AturKeys'
  s.version        = '1.0.0'
  s.summary        = 'Hardware keyboard chords for the Atur terminal'
  s.description    = 'Expo module that takes Ctrl/Alt/Cmd chords and navigation keys from an iPad or iPhone hardware keyboard before the focused text field sees them'
  s.license        = 'MIT'
  s.author         = 'Joyo Digitama'
  s.homepage       = 'https://atur.diatur.com'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/joyodigitama/atur.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.{h,m,mm,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
