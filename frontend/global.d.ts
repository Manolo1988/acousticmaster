import 'react';

declare module '*.css';

declare module 'three/examples/jsm/controls/OrbitControls.js' {
  export * from 'three/examples/jsm/controls/OrbitControls';
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'lottie-player': any;
    }
  }
}
