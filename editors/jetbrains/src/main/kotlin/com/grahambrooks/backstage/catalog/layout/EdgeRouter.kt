package com.grahambrooks.backstage.catalog.layout

import kotlin.math.abs

/** A point in graph coordinates. */
data class Point(val x: Double, val y: Double)

/**
 * The path one edge takes: [points] from the source anchor to the target anchor, with a waypoint
 * in each row the edge must thread between nodes to cross. [sameRow] edges are drawn as an arc
 * over their row instead, so they never run through the nodes between their ends.
 */
data class Route(val points: List<Point>, val sameRow: Boolean)

/**
 * Routes edges around nodes. Plain geometry over a finished [GraphLayout], so it is tested
 * without a UI, and both editors draw the same paths.
 *
 * Rows are bands of nodes sharing a top edge. An edge between different rows leaves the bottom
 * or top centre of its source and enters the facing side of its target. For each row strictly
 * between them, where the straight line would cross a node, the edge is sent straight down (or
 * up) through the nearest gap in that row instead: one waypoint just outside each side of the
 * row, so its diagonal legs stay in the empty space between rows.
 */
class EdgeRouter(layout: GraphLayout, private val clearance: Double = 8.0) {

    private class Band(val top: Double, val bottom: Double, val nodes: List<NodeBounds>)

    private val bands: List<Band> = layout.nodes.values
        .groupBy { it.y }
        .toSortedMap()
        .map { (top, nodes) -> Band(top, nodes.maxOf { it.bottom }, nodes.sortedBy { it.x }) }

    fun route(from: NodeBounds, to: NodeBounds): Route {
        if (abs(from.y - to.y) < 1.0) {
            return Route(listOf(Point(from.centerX, from.y), Point(to.centerX, to.y)), sameRow = true)
        }
        val down = to.y > from.y
        val start = Point(from.centerX, if (down) from.bottom else from.y)
        val end = Point(to.centerX, if (down) to.y else to.bottom)

        val between = bands
            .filter { it.top > minOf(start.y, end.y) && it.bottom < maxOf(start.y, end.y) }
            .let { if (down) it else it.reversed() }

        val points = mutableListOf(start)
        for (band in between) {
            val previous = points.last()
            val near = if (down) band.top else band.bottom
            val far = if (down) band.bottom else band.top
            // Where the straight line to the end would enter and leave this row.
            val xNear = xAt(previous, end, near)
            val xFar = xAt(previous, end, far)
            val low = minOf(xNear, xFar) - clearance
            val high = maxOf(xNear, xFar) + clearance
            if (band.nodes.any { it.right > low && it.x < high }) {
                val gap = nearestGap(band, (xNear + xFar) / 2)
                val step = if (down) clearance else -clearance
                points += Point(gap, near - step)
                points += Point(gap, far + step)
            }
        }
        points += end
        return Route(points, sameRow = false)
    }

    private fun xAt(a: Point, b: Point, y: Double): Double = a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)

    /** The x of the gap in [band] nearest [x]: between two nodes, or beside the row's ends. */
    private fun nearestGap(band: Band, x: Double): Double {
        val nodes = band.nodes
        val candidates = buildList {
            add(nodes.first().x - clearance * 2)
            nodes.zipWithNext { left, right ->
                if (right.x - left.right >= clearance * 2) add((left.right + right.x) / 2)
            }
            add(nodes.last().right + clearance * 2)
        }
        return candidates.minBy { abs(it - x) }
    }
}
