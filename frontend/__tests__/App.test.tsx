import React from 'react';
import { render } from '@testing-library/react-native';
import App from '../App';

describe('<App />', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<App />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the home screen correctly', () => {
    const { getByText } = render(<App />);

    expect(getByText('Welcome to Prep')).toBeTruthy();
    expect(getByText("What's in your fridge today?")).toBeTruthy();
    expect(getByText('Scan Ingredients')).toBeTruthy();
    expect(getByText('Upload Photo')).toBeTruthy();
    expect(getByText('Enter Ingredients')).toBeTruthy();
    expect(getByText('Preferences')).toBeTruthy();
  });
});
