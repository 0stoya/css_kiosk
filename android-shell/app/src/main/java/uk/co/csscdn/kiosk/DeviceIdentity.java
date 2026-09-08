package uk.co.csscdn.kiosk;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;

final class DeviceIdentity {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String ALIAS = "css-kiosk-device-v1";

    private final KeyStore keyStore;

    DeviceIdentity() throws GeneralSecurityException {
        keyStore = KeyStore.getInstance(KEYSTORE);
        try {
            keyStore.load(null);
        } catch (java.io.IOException exception) {
            throw new GeneralSecurityException("Could not load Android Keystore", exception);
        }
        ensureKey();
    }

    String deviceId() throws GeneralSecurityException {
        byte[] encoded = publicKey().getEncoded();
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(encoded);
        StringBuilder value = new StringBuilder("android-");
        for (int index = 0; index < 12; index += 1) {
            value.append(String.format("%02x", digest[index]));
        }
        return value.toString();
    }

    String publicJwkJson() throws GeneralSecurityException {
        ECPublicKey publicKey = publicKey();
        JSONObject jwk = new JSONObject();
        try {
            jwk.put("kty", "EC");
            jwk.put("crv", "P-256");
            jwk.put("x", base64Url(unsignedCoordinate(publicKey.getW().getAffineX())));
            jwk.put("y", base64Url(unsignedCoordinate(publicKey.getW().getAffineY())));
        } catch (JSONException exception) {
            throw new GeneralSecurityException("Could not encode public key", exception);
        }
        return jwk.toString();
    }

    String signUtf8(String payload) throws GeneralSecurityException {
        Signature signature = Signature.getInstance("SHA256withECDSA");
        signature.initSign((java.security.PrivateKey) keyStore.getKey(ALIAS, null));
        signature.update(payload.getBytes(StandardCharsets.UTF_8));
        return base64Url(signature.sign());
    }

    private void ensureKey() throws GeneralSecurityException {
        if (keyStore.containsAlias(ALIAS)) return;

        KeyPairGenerator generator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            KEYSTORE
        );
        generator.initialize(
            new KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .build()
        );
        generator.generateKeyPair();
    }

    private ECPublicKey publicKey() throws GeneralSecurityException {
        java.security.cert.Certificate certificate = keyStore.getCertificate(ALIAS);
        if (certificate == null || !(certificate.getPublicKey() instanceof ECPublicKey)) {
            throw new GeneralSecurityException("Android kiosk public key is unavailable");
        }
        return (ECPublicKey) certificate.getPublicKey();
    }

    private static byte[] unsignedCoordinate(BigInteger value) {
        byte[] source = value.toByteArray();
        byte[] coordinate = new byte[32];
        int sourceOffset = Math.max(0, source.length - coordinate.length);
        int length = Math.min(source.length, coordinate.length);
        System.arraycopy(source, sourceOffset, coordinate, coordinate.length - length, length);
        return coordinate;
    }

    private static String base64Url(byte[] bytes) {
        return Base64.encodeToString(
            bytes,
            Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING
        );
    }
}
