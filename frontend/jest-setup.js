// Set up fake timers to prevent async issues
jest.useFakeTimers();

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Mock expo-camera
jest.mock('expo-camera', () => {
  const React = require('react');
  return {
    CameraView: React.forwardRef((props, ref) => React.createElement('View', props)),
    useCameraPermissions: jest.fn(() => [
      { granted: true }, 
      jest.fn()
    ]),
  };
});

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
  useMediaLibraryPermissions: jest.fn(() => [
    { granted: true },
    jest.fn(),
  ]),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: {
    Images: 'Images',
  },
}));

// Mock safe area context
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    SafeAreaProvider: jest.fn(({ children }) => children),
    SafeAreaView: jest.fn(({ children }) => children),
    useSafeAreaInsets: jest.fn(() => inset),
  };
});
