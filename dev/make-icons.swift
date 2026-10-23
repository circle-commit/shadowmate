// Draws the extension icon (two subtitle bars on a system-blue tile) into icons/icon{16,32,48,128}.png.
// Run from the project folder: swift dev/make-icons.swift
import AppKit

func draw(size: Int) -> Data {
  let s = CGFloat(size)
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  // Chrome's store icon is 96px art with 16px clear padding in 128; small toolbar sizes use nearly the whole square.
  let inset = size >= 128 ? s / 8 : max(1, s / 16)
  let tile = CGRect(x: inset, y: inset, width: s - 2 * inset, height: s - 2 * inset)
  let t = tile.width
  // Small sizes snap to whole pixels so the bars stay crisp.
  func px(_ v: CGFloat) -> CGFloat { size <= 32 ? v.rounded() : v }

  ctx.addPath(CGPath(roundedRect: tile, cornerWidth: t * 0.225, cornerHeight: t * 0.225, transform: nil))
  ctx.clip()
  let blue = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!, colors: [
    CGColor(srgbRed: 0.27, green: 0.63, blue: 1.0, alpha: 1), // top
    CGColor(srgbRed: 0.03, green: 0.44, blue: 0.93, alpha: 1), // bottom
  ] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(blue, start: CGPoint(x: 0, y: tile.maxY), end: CGPoint(x: 0, y: tile.minY), options: [])
  ctx.resetClip()

  // Two lines of subtitles in two colors (two languages): the original in white over its translation in Apple's
  // yellow, the panel's ★ color; centered as a group.
  let h1 = px(max(2, t * 0.15)), h2 = px(max(1.5, t * 0.115)), gap = px(max(1, t * 0.1))
  let w1 = px(t * 0.64), w2 = px(t * 0.44)
  let top = px(tile.midY + (h1 + gap + h2) / 2) // CoreGraphics y grows upward
  let bar1 = CGRect(x: px(tile.midX - w1 / 2), y: top - h1, width: w1, height: h1)
  let bar2 = CGRect(x: px(tile.midX - w2 / 2), y: top - h1 - gap - h2, width: w2, height: h2)
  for (bar, color) in [(bar1, CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)), (bar2, CGColor(srgbRed: 1, green: 0.84, blue: 0.04, alpha: 1))] {
    ctx.setFillColor(color)
    ctx.addPath(CGPath(roundedRect: bar, cornerWidth: bar.height / 2, cornerHeight: bar.height / 2, transform: nil))
    ctx.fillPath()
  }
  return NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .png, properties: [:])!
}

try FileManager.default.createDirectory(atPath: "icons", withIntermediateDirectories: true)
for size in [16, 32, 48, 128] {
  try draw(size: size).write(to: URL(fileURLWithPath: "icons/icon\(size).png"))
  print("icons/icon\(size).png")
}
