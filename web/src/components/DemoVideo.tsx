interface Props {
  onBack: () => void
}

const MEDIA = `${import.meta.env.BASE_URL}media/`

/** The narrated 90-second walkthrough, with captions. The video lives in R2; the Worker streams it. */
export function DemoVideo({ onBack }: Props) {
  return (
    <section className="demo-page" aria-labelledby="demo-title">
      <h2 id="demo-title">See it in 90 seconds</h2>
      <p className="demo-lede">
        A narrated walkthrough of the Navigator: from the whole Moon down to the ground at the south pole, and how
        a planner checks sunlight, Earth contact and a slipped launch date.
      </p>
      <video className="demo-video" controls preload="metadata" playsInline poster={`${MEDIA}demo-poster.jpg`}>
        <source src={`${MEDIA}demo.mp4`} type="video/mp4" />
        <track kind="captions" src={`${MEDIA}demo.vtt`} srcLang="en" label="English" default />
        Your browser can't play this video. <a href={`${MEDIA}demo.mp4`}>Download it</a> instead.
      </video>
      <p className="note">
        Recorded from the live app; every number on screen comes from our pipeline. Narration is synthetic: Google
        Cloud Text-to-Speech (Chirp 3 HD voice), from a script we wrote.
      </p>
      <p className="actions">
        <button type="button" onClick={onBack}>
          Open the app
        </button>
      </p>
    </section>
  )
}
