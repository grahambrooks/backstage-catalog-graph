package com.grahambrooks.backstage.catalog.layout

import com.grahambrooks.backstage.catalog.model.EntityRef
import kotlin.math.abs

enum class Direction { LEFT, RIGHT, UP, DOWN }

/**
 * Arrow-key movement between nodes, by position on screen rather than by relation, so it goes
 * where the user is looking. Left and right stay in the row; up and down go to the nearest row
 * in that direction, then to the node closest horizontally.
 */
object Navigation {

    /**
     * The node to select after moving [direction] from [from]. With nothing selected, the first
     * node in reading order; with nowhere to go, [from] itself.
     */
    fun step(layout: GraphLayout, from: EntityRef?, direction: Direction): EntityRef? {
        val current = from?.let { layout.nodes[it] }
            ?: return layout.nodes.values.minWithOrNull(compareBy({ it.y }, { it.x }))?.node?.ref
        val others = layout.nodes.values.filter { it != current }

        val next = when (direction) {
            Direction.LEFT -> others.filter { it.y == current.y && it.x < current.x }.maxByOrNull { it.x }
            Direction.RIGHT -> others.filter { it.y == current.y && it.x > current.x }.minByOrNull { it.x }
            Direction.UP, Direction.DOWN -> {
                val ahead = others.filter {
                    if (direction == Direction.UP) it.y < current.y else it.y > current.y
                }
                val row = ahead.minByOrNull { abs(it.y - current.y) }?.y
                ahead.filter { it.y == row }.minByOrNull { abs(it.centerX - current.centerX) }
            }
        }
        return next?.node?.ref ?: from
    }
}
