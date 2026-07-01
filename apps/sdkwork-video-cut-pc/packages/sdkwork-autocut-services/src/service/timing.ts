export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const randomDelay = (min = 300, max = 800) =>
  delay(Math.floor(Math.random() * (max - min + 1) + min));
