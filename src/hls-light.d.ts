// hls.js ships no typings for its smaller "light" build; it has the same API.
declare module 'hls.js/light' {
  export * from 'hls.js'
  export { default } from 'hls.js'
}
