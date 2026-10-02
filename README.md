# Chumi: Tell it to water

A mindfulness app for iPhone. Hold the button and say what is on your mind. While you speak, water runs from above into a slowly moving gradient and ripples out like a real basin. Let go, the words sink, and the app tells you: *You were heard*.

## Try it on iPhone

1. Open the GitHub Pages link in Safari.
2. Tap Share, then **Add to Home Screen**. It opens full screen like a native app.
3. Hold the microphone button, speak, release. Allow Microphone and Speech Recognition the first time.

Add `?demo` to the URL to watch the flow with a scripted voice and no microphone.

## How it works

- **Water**: a GPU wave-equation height field (WebGL2, half-float ping-pong textures). A stream pours from the top of the screen, thinning and beading as it falls, and stirs the surface where it lands, with foam and air at the impact. Let go and the tail falls away, then the rings settle.
- **Gradient**: an aquarelle after the "Restful" moodboard image: aqua wash, sweeping violet and cobalt bands, thin coral and navy lines and cream arcs, dry-brush break-up and paper grain over everything.
- **Rings**: no drawn outlines. The waves bend the paint beneath them and push it around (a displacement field that drifts, bleeds and slowly settles back), so the rings appear in the painting's own colours.
- **Glass button**: drawn in the same shader, so it really refracts the water beneath it, with a bent rim, slight colour split and a specular edge.
- **Listening**: Safari's speech recognition shows your words as you speak, and each new word swells the stream. Without speech recognition, the microphone level sets how hard the water runs.

No build step: `index.html`, `style.css`, `app.js`. Serve the folder over HTTPS (the microphone needs it).
