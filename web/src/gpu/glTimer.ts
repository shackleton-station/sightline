/**
 * Times what the GPU does between begin() and end() on a WebGL2 context, with the browser's
 * EXT_disjoint_timer_query_webgl2 where it offers it. A result arrives a few frames after its
 * frame was drawn, so read() hands back whichever have come in since the last call.
 */
export class GlTimer {
  /** False where the browser doesn't offer the extension: begin, end and read then do nothing. */
  readonly offered: boolean
  private readonly gl: WebGL2RenderingContext
  private readonly timeElapsed: number
  private readonly disjoint: number
  private readonly waiting: WebGLQuery[] = []
  private open: WebGLQuery | null = null

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
    this.offered = extension !== null
    this.timeElapsed = extension?.TIME_ELAPSED_EXT ?? 0
    this.disjoint = extension?.GPU_DISJOINT_EXT ?? 0
  }

  begin(): void {
    // Only so many may wait at once: a frame goes untimed rather than queue without end.
    if (!this.offered || this.waiting.length >= 8) return
    this.open = this.gl.createQuery()
    if (this.open) this.gl.beginQuery(this.timeElapsed, this.open)
  }

  end(): void {
    if (!this.open) return
    this.gl.endQuery(this.timeElapsed)
    this.waiting.push(this.open)
    this.open = null
  }

  /** Milliseconds for each frame whose answer has come in, oldest first. */
  read(): number[] {
    const { gl } = this
    const done: number[] = []
    // "Disjoint" means something interrupted the GPU (another tab, a power change): those timings are thrown away.
    const interrupted = this.offered && (gl.getParameter(this.disjoint) as boolean)
    while (this.waiting.length > 0 && (gl.getQueryParameter(this.waiting[0], gl.QUERY_RESULT_AVAILABLE) as boolean)) {
      const query = this.waiting.shift() as WebGLQuery
      if (!interrupted) done.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6)
      gl.deleteQuery(query)
    }
    return done
  }
}
