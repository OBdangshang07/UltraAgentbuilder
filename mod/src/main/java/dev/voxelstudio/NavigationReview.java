package dev.voxelstudio;
import com.google.gson.JsonObject;

/** Asset-scoped acknowledgement, never a persistent global opt-out. */
public final class NavigationReview {
    private NavigationReview(){}
    public static boolean required(JsonObject manifest){
        if(!manifest.has("quality"))return true; // Legacy imports have no explicit review provenance.
        var q=manifest.getAsJsonObject("quality");
        if(q.get("version").getAsInt()!=1)throw new IllegalArgumentException("Unsupported asset quality version");
        String status=q.get("navigation").getAsString();
        if(!java.util.Set.of("verified","unverified","not-requested").contains(status))throw new IllegalArgumentException("Invalid navigation quality status");
        boolean required=!status.equals("verified");
        if(q.get("requiresAcknowledgement").getAsBoolean()!=required)throw new IllegalArgumentException("Inconsistent navigation acknowledgement metadata");
        return required;
    }
    public static void requireAcknowledged(boolean required,boolean acknowledged){
        if(required&&!acknowledged)throw new IllegalStateException("通行未验证：必须在当前建造确认页明确勾选风险确认；没有修改世界");
    }
}
