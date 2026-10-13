import { Path, Svg } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

/** The Atur "A" roof mark (apps/app/public/icon-1024.png), in vector form. */
export function LogoMark({ size = 48 }: { size?: number }) {
  const { theme } = useUnistyles();
  return (
    <Svg width={size} height={size} viewBox="200 200 624 560" accessibilityLabel="Atur">
      <Path d="M212 736 512 225 812 736H706L512 406 318 736Z" fill={theme.colors.foreground} />
      <Path d="M458 590 512 498 566 590V736H458Z" fill={theme.colors.foreground} />
    </Svg>
  );
}
