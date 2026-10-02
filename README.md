# Chumi: Tell it to water

A mindfulness app for iPhone. Hold the button and say what is on your mind. While you speak, drops fall into a slowly moving gradient and ripple out like real water. Let go, the words sink, and the app tells you: *You were heard*.

## Try it on iPhone

1. Open the GitHub Pages link in Safari.
2. Tap Share, then **Add to Home Screen**. It opens full screen like a native app.
3. Hold the microphone button, speak, release. Allow Microphone and Speech Recognition the first time.

Add `?demo` to the URL to watch the flow with a scripted voice and no microphone.

## How it works

- **Water**: a GPU wave-equation height field (WebGL2, half-float ping-pong textures). Each drop is a falling water lens with its shadow, an impact crown, and a second smaller ring from the rebound jet. The surface refracts the colour field below and catches light on the ring crests.
- **Gradient**: domain-warped noise in the moodboard palette (night ink, steel blue, teal haze, sage, a little chartreuse light).
- **Listening**: Safari's speech recognition shows your words as you speak, and each new word lets a drop fall. Without speech recognition, the microphone level drives the drops instead.

No build step: `index.html`, `style.css`, `app.js`. Serve the folder over HTTPS (the microphone needs it).
