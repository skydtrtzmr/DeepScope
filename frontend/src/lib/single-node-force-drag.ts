import { DragElementForce, ExtensionCategory, register } from '@antv/g6';

/** Selection is for inspection, not a multi-node drag selection. */
export class SingleNodeForceDrag extends DragElementForce {
  protected getSelectedNodeIDs(currentTarget: string[]): string[] {
    return currentTarget;
  }
}

export const SINGLE_NODE_FORCE_DRAG = 'deepscope-single-node-force-drag';
register(ExtensionCategory.BEHAVIOR, SINGLE_NODE_FORCE_DRAG, SingleNodeForceDrag);
