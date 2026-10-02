# Chumi: Tell it to water

A mindfulness app for iPhone. Hold the button and say what is on your mind. While you speak, water runs from above into a slowly moving gradient and ripples out like a real basin. Let go, the words sink, and the app tells you: *You were heard*.

## Try it on iPhone

1. Open the GitHub Pages link in Safari.
2. Tap Share, then **Add to Home Screen**. It opens full screen like a native app.
3. Hold the microphone button, speak, release. Allow Microphone and Speech Recognition the first time.

Add `?demo` to the URL to watch the flow with a scripted voice and no microphone.

## How it works

- **Water**: a GPU simulation on half-float ping-pong textures (WebGL2). A stream pours from the top of the screen, thinning and beading as it falls, and blooms into the paint where it lands. Let go and the tail falls away.
- **Gradient**: an aquarelle after the "Restful" moodboard image: aqua wash, sweeping violet and cobalt bands, thin coral and navy lines and cream arcs, dry-brush break-up and paper grain over everything.
- **Blooms**: water landing on the wet painting behaves like a watercolour backrun. It spreads as a porous-medium flow over a fibrous paper map, so the front stays crisp and fringed; it dilutes the pigment in the middle and carries it to the edge, where it settles as a darker line. Splashes make their own small blooms. When the water stops, the bloom dries, keeps its hard edge for a while, then fades.
- **Glass button**: drawn in the same shader, so it really refracts the water beneath it, with a bent rim, slight colour split and a specular edge.
- **Listening**: Safari's speech recognition shows your words as you speak, and each new word swells the stream. Without speech recognition, the microphone level sets how hard the water runs.

No build step: `index.html`, `style.css`, `app.js`. Serve the folder over HTTPS (the microphone needs it).
