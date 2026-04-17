import 'react';

declare module '*.css';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'lottie-player': any;
    }
  }
}
