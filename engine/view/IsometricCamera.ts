import * as THREE from 'three'

export class IsometricCamera {
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  private viewSize = 12

  constructor() {
    this.camera.position.set(10, 10, 10)
    this.camera.lookAt(0, 0, 0)
  }

  resize(aspect: number): void {
    const s = this.viewSize
    this.camera.left = (-s * aspect) / 2
    this.camera.right = (s * aspect) / 2
    this.camera.top = s / 2
    this.camera.bottom = -s / 2
    this.camera.updateProjectionMatrix()
  }
}
