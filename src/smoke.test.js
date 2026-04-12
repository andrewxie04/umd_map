test('test environment is configured', () => {
  const el = document.createElement('div');
  el.textContent = 'UMDRooms';

  expect(el).toBeTruthy();
  expect(el.textContent).toBe('UMDRooms');
});
