import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'lottie-player': any;
    }
  }
}
