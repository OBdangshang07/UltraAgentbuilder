package dev.voxelstudio.client;

/** Read-only guidance. It never starts a job, changes settings or grants placement consent. */
public final class StudioWorkflow {
    private StudioWorkflow() {}

    public record State(boolean uncertainTask, boolean generating, boolean placing,
                        boolean hasAsset, boolean locked, boolean modelReady, boolean hasDescription) {}
    public record Guidance(String heading, String next) {}

    public static Guidance guidance(State state) {
        if (state.placing()) return new Guidance("正在建造", "可返回游戏等待；停止只会阻止后续批次");
        if (state.uncertainTask()) return new Guidance("先查询原任务", "打开工具页恢复原任务，避免重复生成");
        if (state.generating()) return new Guidance("建筑制作中", "可以关闭面板继续游戏，完成后再摆放");
        if (state.hasAsset() && state.locked()) return new Guidance("位置已锁定", "打开摆放页，检查位置并确认建造");
        if (state.hasAsset()) return new Guidance("建筑已就绪", "到世界中摆放，用滚轮调整距离，再锁定位置");
        if (!state.modelReady()) return new Guidance("选择制作来源", "也可加载示例，免费体验预览和摆放");
        if (!state.hasDescription()) return new Guidance("描述你的建筑", "写下建筑类型、风格和规模，然后生成预览");
        return new Guidance("可以开始生成", "生成后先看预览，确认位置后再建造");
    }
}
