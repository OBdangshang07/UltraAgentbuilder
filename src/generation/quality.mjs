/** A design-quality failure is not an invalid or unsafe geometry buffer. */
export class NavigationQualityError extends Error {
  constructor(message,code='navigation-unverified'){super(message);this.name='NavigationQualityError';this.code=code;}
}
export function navigationIssue(error){return {code:error.code??'navigation-unverified',message:error.message};}
export const UNVERIFIED_NOTE='通行未验证：建筑几何可预览，但可能有堵门、缺地板或不连通楼层。未自动挖空、移动或修建任何方块；建造前必须明确确认此风险。';
