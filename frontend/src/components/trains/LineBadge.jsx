import Icon from "../Icon";
import { lineBadge } from "../../lib/trains";

/** Pastille de ligne (« K44 ») aux couleurs publiées par le transporteur ; icône car pour un autocar. */
export default function LineBadge({ line, journey = null }) {
  const { name, style } = lineBadge(line, journey);
  return (
    <span className="line-badge" style={style ?? undefined}>
      {journey?.mode === "car" && <Icon name="bus" size={13} />}
      {name}
    </span>
  );
}
