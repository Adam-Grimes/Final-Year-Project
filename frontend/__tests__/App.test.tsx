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
    
    // Check for the Title
    expect(getByText('Prep')).toBeTruthy();

    // Check for the Buttons
    expect(getByText('Take Photo')).toBeTruthy();
    expect(getByText('Upload from Gallery')).toBeTruthy();
  });
});
